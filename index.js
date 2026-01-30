require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType
} = require('discord.js');
const {
  joinVoiceChannel,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior
} = require('@discordjs/voice');
const play = require('play-dl');
const express = require('express');
const bodyParser = require('body-parser');

const {
  DISCORD_TOKEN,
  LOG_CHANNEL_ID,
  LTC_ADDRESS,
  WEBHOOK_SECRET,
  PORT
} = process.env;

// ---- CONSTANTS ----
const KAUTIS_PINK = 0xff66cc;
const TICKET_CATEGORY_ID = '1466857802222796941';
const BUYER_ROLE_ID = '1466858539799806146';
const CONTROL_CHANNEL_ID = '1466867050868899841';
const MAX_SESSIONS = 10;

// ---- STATE ----
const tosAccepted = new Set();

// sessions: array of { guildId, userId, voiceChannelId, textChannelId, queueKey }
const sessions = [];

// musicQueues: key = queueKey (voiceChannelId), value = { songs, player, connection, playing }
const musicQueues = new Map();

// ---- DISCORD CLIENT ----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// ---- EXPRESS APP (LTC WEBHOOK) ----
const app = express();
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.status(200).send('Kautis bot + webhook running');
});

async function findUserTicketChannel(userId) {
  for (const guild of client.guilds.cache.values()) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    const ticketChannel = guild.channels.cache.find(
      (ch) =>
        ch.type === ChannelType.GuildText &&
        ch.parentId === TICKET_CATEGORY_ID &&
        ch.name.startsWith('ticket-') &&
        ch.permissionsFor(member)?.has(PermissionsBitField.Flags.ViewChannel)
    );
    if (ticketChannel) return ticketChannel;
  }
  return null;
}

app.post('/ltc-webhook', async (req, res) => {
  try {
    const signature = req.headers['x-webhook-signature'];
    if (!signature || signature !== WEBHOOK_SECRET) {
      return res.status(401).send('Invalid signature');
    }

    const { txId, amount, currency, address, userId } = req.body;
    if (!txId || !amount || !currency || !address) {
      return res.status(400).send('Missing fields');
    }
    if (address !== LTC_ADDRESS) {
      return res.status(400).send('Payment not to your LTC address');
    }

    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setTitle('💸 LTC Payment Received')
        .setColor(KAUTIS_PINK)
        .setDescription('A new Litecoin payment has been detected for **Kautis**.')
        .addFields(
          { name: 'TX ID', value: `\`${txId}\``, inline: false },
          { name: 'Amount', value: `\`${amount} ${currency}\``, inline: true },
          { name: 'Address', value: `\`${address}\``, inline: true },
          { name: 'Linked User ID', value: userId ? `\`${userId}\`` : '`None provided`', inline: false }
        )
        .setFooter({ text: 'Kautis • Payment Log' })
        .setTimestamp();
      await logChannel.send({ embeds: [embed] });
    }

    if (userId) {
      try {
        const user = await client.users.fetch(userId);
        await user.send(
          `💸 Your LTC payment to **Kautis** has been detected.\n\n` +
          `TX: \`${txId}\`\nAmount: \`${amount} ${currency}\`\n\n` +
          `You can now proceed with your middleman transaction.`
        );
      } catch (e) {
        console.error('Failed to DM user:', e.message);
      }

      const ticketChannel = await findUserTicketChannel(userId);
      if (ticketChannel) {
        const embed = new EmbedBuilder()
          .setTitle('✅ Payment Confirmed')
          .setColor(KAUTIS_PINK)
          .setDescription(
            `Thanks for purchasing at **Kautis**!\n\n` +
            `Your payment has been confirmed. You can now claim your **Buyer** role below.`
          )
          .setFooter({ text: 'Kautis • Buyer Confirmation' })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('get_buyer_role')
            .setLabel('Get Buyer Role')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🛒')
        );

        await ticketChannel.send({ content: `<@${userId}>`, embeds: [embed], components: [row] });
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Server error');
  }
});

app.listen(PORT || 3000, () => {
  console.log(`Webhook server listening on port ${PORT || 3000}`);
});

// ---- MUSIC HELPERS ----
function getOrCreateQueue(queueKey, guild, voiceChannelId) {
  if (!musicQueues.has(queueKey)) {
    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
    });

    const queue = {
      songs: [],
      player,
      connection: null,
      playing: false,
      guildId: guild.id,
      voiceChannelId
    };

    player.on(AudioPlayerStatus.Idle, () => {
      if (queue.songs.length > 0) queue.songs.shift();
      if (queue.songs.length > 0) {
        playNext(queueKey);
      } else {
        queue.playing = false;
      }
    });

    player.on('error', (error) => {
      console.error('Audio player error:', error);
      if (queue.songs.length > 0) queue.songs.shift();
      if (queue.songs.length > 0) {
        playNext(queueKey);
      } else {
        queue.playing = false;
      }
    });

    musicQueues.set(queueKey, queue);
  }
  return musicQueues.get(queueKey);
}

async function playNext(queueKey) {
  const queue = musicQueues.get(queueKey);
  if (!queue || queue.songs.length === 0) return;

  const song = queue.songs[0];
  try {
    const stream = await play.stream(song.url);
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    queue.player.play(resource);
    queue.playing = true;
  } catch (err) {
    console.error('Error playing song:', err);
    queue.songs.shift();
    if (queue.songs.length > 0) {
      playNext(queueKey);
    } else {
      queue.playing = false;
    }
  }
}

function findSessionByTextChannel(textChannelId) {
  return sessions.find((s) => s.textChannelId === textChannelId);
}

function findSessionByVoiceChannel(voiceChannelId) {
  return sessions.find((s) => s.voiceChannelId === voiceChannelId);
}

function findSessionByUser(guildId, userId) {
  return sessions.find((s) => s.guildId === guildId && s.userId === userId);
}

function removeSession(queueKey) {
  const idx = sessions.findIndex((s) => s.queueKey === queueKey);
  if (idx !== -1) sessions.splice(idx, 1);
  musicQueues.delete(queueKey);
}

// ---- DISCORD EVENTS ----
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Voice state: auto-delete session channels when user leaves
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!oldState.channelId || oldState.channelId === newState.channelId) return;

  const session = findSessionByVoiceChannel(oldState.channelId);
  if (!session) return;

  const channel = oldState.guild.channels.cache.get(session.voiceChannelId);
  if (!channel || channel.type !== ChannelType.GuildVoice) return;

  const nonBotMembers = channel.members.filter((m) => !m.user.bot);
  if (nonBotMembers.size === 0) {
    const queue = musicQueues.get(session.queueKey);
    if (queue) {
      const conn = getVoiceConnection(queue.guildId);
      if (conn) conn.destroy();
      musicQueues.delete(session.queueKey);
    }

    const textChannel = oldState.guild.channels.cache.get(session.textChannelId);
    if (textChannel) await textChannel.delete().catch(() => null);
    await channel.delete().catch(() => null);

    removeSession(session.queueKey);
  }
});

// ---- MESSAGE COMMANDS ----
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // TOS
  if (message.content.startsWith('!tos')) {
    const embed = new EmbedBuilder()
      .setTitle('📜 Kautis Terms of Service')
      .setColor(KAUTIS_PINK)
      .setDescription(
        `By using **Kautis** you agree to the following:\n\n` +
        `1. You will not use this service for illegal activities.\n` +
        `2. All payments are final unless otherwise stated.\n` +
        `3. Kautis staff are not responsible for deals outside agreed terms.\n` +
        `4. You must follow all server rules and Discord ToS.\n\n` +
        `Click **"I Agree"** below to continue using the service.`
      )
      .setFooter({ text: 'Kautis • TOS' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('tos_agree')
        .setLabel('I Agree')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅')
    );

    await message.reply({ embeds: [embed], components: [row] });
    return;
  }

  if (!message.content.startsWith('!')) return;
  const args = message.content.slice(1).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();

  // Payment info
  if (command === 'payment') {
    const embed = new EmbedBuilder()
      .setTitle('💰 Kautis Payment Instructions')
      .setColor(KAUTIS_PINK)
      .setDescription(
        `You can pay using **Litecoin (LTC)**.\n\n` +
        `**LTC Address:**\n\`\`\`\n${LTC_ADDRESS}\n\`\`\`\n` +
        `After sending, wait for confirmations. The system will detect it via webhook and log it.`
      )
      .setFooter({ text: 'Kautis • Payment Info' });
    await message.reply({ embeds: [embed] });
  }

  // Ticket setup
  if (command === 'ticketsetup') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('Only administrators can run this command.');
    }

    const embed = new EmbedBuilder()
      .setTitle('🎫 Kautis Support Tickets')
      .setColor(KAUTIS_PINK)
      .setDescription(
        `Need help with a middleman transaction?\n\n` +
        `Click the button below to open a private ticket with **Kautis** staff.\n\n` +
        `Once inside, you’ll be asked:\n` +
        `• What do you want to buy?\n` +
        `• How much do you want to buy?\n\n` +
        `Please answer clearly so we can assist you quickly.`
      )
      .setFooter({ text: 'Kautis • Ticket Panel' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('create_ticket')
        .setLabel('Create Ticket')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎫')
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.reply('Ticket panel created.');
  }

  // Music control panel
  if (command === 'musicpanel') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('Only administrators can run this command.');
    }
    if (message.channel.id !== CONTROL_CHANNEL_ID) {
      return message.reply('Run this command in the control channel only.');
    }

    const embed = new EmbedBuilder()
      .setTitle('🎵 Kautis Music Control Panel')
      .setColor(KAUTIS_PINK)
      .setDescription(
        `Press the button below to start your **private music session**.\n\n` +
        `You’ll get your own private voice + text channel where you can queue songs.`
      )
      .setFooter({ text: 'Kautis • Music Control' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('start_music_session')
        .setLabel('Start Music Session')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🎧')
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.reply('Music control panel created.');
  }

  // Moderation: ban
  if (command === 'ban') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return message.reply('You do not have permission to use this command.');
    }
    const target = message.mentions.members.first();
    if (!target) return message.reply('Please mention a user to ban.');
    const reason = args.join(' ') || 'No reason provided';
    try {
      await target.ban({ reason });
      await message.reply(`🔨 Banned **${target.user.tag}** | Reason: ${reason}`);
    } catch {
      message.reply('Failed to ban that user.');
    }
  }

  // Moderation: kick
  if (command === 'kick') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      return message.reply('You do not have permission to use this command.');
    }
    const target = message.mentions.members.first();
    if (!target) return message.reply('Please mention a user to kick.');
    const reason = args.join(' ') || 'No reason provided';
    try {
      await target.kick(reason);
      await message.reply(`👢 Kicked **${target.user.tag}** | Reason: ${reason}`);
    } catch {
      message.reply('Failed to kick that user.');
    }
  }

  // Moderation: mute (1 hour)
  if (command === 'mute') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      return message.reply('You do not have permission to use this command.');
    }
    const target = message.mentions.members.first();
    if (!target) return message.reply('Please mention a user to mute.');
    const durationMs = 60 * 60 * 1000;
    const reason = args.join(' ') || 'Muted for 1 hour';
    try {
      await target.timeout(durationMs, reason);
      await message.reply(`🔇 Muted **${target.user.tag}** for 1 hour | Reason: ${reason}`);
    } catch {
      message.reply('Failed to mute that user.');
    }
  }

  // ---- MUSIC COMMANDS (per-session) ----
  const session = findSessionByTextChannel(message.channel.id);
  let queueKey = null;
  let queue = null;

  if (session) {
    queueKey = session.queueKey;
    queue = musicQueues.get(queueKey);
  }

  // If no session but user in a VC, allow generic use (fallback)
  if (!session && ['play', 'skip', 'stop', 'queue', 'pause', 'resume'].includes(command)) {
    const vc = message.member.voice.channel;
    if (!vc) return message.reply('You must be in a voice channel or use your private session.');
    queueKey = vc.id;
    queue = getOrCreateQueue(queueKey, message.guild, vc.id);
    if (!queue.connection) {
      const connection = joinVoiceChannel({
        channelId: vc.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator
      });
      queue.connection = connection;
      connection.subscribe(queue.player);
    }
  }

  // !play
  if (command === 'play') {
    const query = args.join(' ');
    if (!query) return message.reply('Provide a song name or YouTube URL.');

    if (!queueKey || !queue) return message.reply('No active session or voice channel found.');

    let url = query;
    let info;
    try {
      if (!play.yt_validate(query)) {
        const results = await play.search(query, { limit: 1 });
        if (!results || results.length === 0) {
          return message.reply('No results found for that search.');
        }
        url = results[0].url;
        info = results[0];
      } else {
        info = await play.video_info(query);
        url = info.video_details.url;
      }
    } catch (err) {
      console.error(err);
      return message.reply('Failed to fetch that track.');
    }

    const song = {
      title: info.title,
      url,
      requestedBy: message.author.tag
    };

    queue.songs.push(song);

    const embed = new EmbedBuilder()
      .setTitle('🎵 Added to Queue')
      .setColor(KAUTIS_PINK)
      .setDescription(`**${song.title}**`)
      .addFields(
        { name: 'Requested by', value: song.requestedBy, inline: true },
        { name: 'Position in queue', value: `${queue.songs.length}`, inline: true }
      )
      .setFooter({ text: 'Kautis • Music' });

    await message.reply({ embeds: [embed] });

    if (!queue.playing) {
      playNext(queueKey);
    }
  }

  if (command === 'skip') {
    if (!queue || queue.songs.length === 0) return message.reply('Nothing to skip.');
    queue.player.stop(true);
    const embed = new EmbedBuilder()
      .setTitle('⏭ Skipped')
      .setColor(KAUTIS_PINK)
      .setDescription('Skipped the current track.')
      .setFooter({ text: 'Kautis • Music' });
    await message.reply({ embeds: [embed] });
  }

  if (command === 'stop') {
    if (!queue || queue.songs.length === 0) return message.reply('Nothing is playing.');
    queue.songs.length = 0;
    queue.player.stop(true);
    const embed = new EmbedBuilder()
      .setTitle('⏹ Stopped')
      .setColor(KAUTIS_PINK)
      .setDescription('Stopped playback and cleared the queue.')
      .setFooter({ text: 'Kautis • Music' });
    await message.reply({ embeds: [embed] });
  }

  if (command === 'queue') {
    if (!queue || queue.songs.length === 0) return message.reply('The queue is empty.');
    const description = queue.songs
      .map((s, i) => `${i === 0 ? '**Now:**' : `\`${i}\``} ${s.title} *(requested by ${s.requestedBy})*`)
      .join('\n');
    const embed = new EmbedBuilder()
      .setTitle('📜 Queue')
      .setColor(KAUTIS_PINK)
      .setDescription(description)
      .setFooter({ text: 'Kautis • Music' });
    await message.reply({ embeds: [embed] });
  }

  if (command === 'pause') {
    if (!queue || !queue.playing) return message.reply('Nothing is playing.');
    queue.player.pause();
    const embed = new EmbedBuilder()
      .setTitle('⏸ Paused')
      .setColor(KAUTIS_PINK)
      .setDescription('Paused the current track.')
      .setFooter({ text: 'Kautis • Music' });
    await message.reply({ embeds: [embed] });
  }

  if (command === 'resume') {
    if (!queue || queue.player.state.status !== AudioPlayerStatus.Paused) {
      return message.reply('Nothing is paused.');
    }
    queue.player.unpause();
    const embed = new EmbedBuilder()
      .setTitle('▶ Resumed')
      .setColor(KAUTIS_PINK)
      .setDescription('Resumed playback.')
      .setFooter({ text: 'Kautis • Music' });
    await message.reply({ embeds: [embed] });
  }
});

// ---- INTERACTIONS ----
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  // TOS
  if (interaction.customId === 'tos_agree') {
    tosAccepted.add(interaction.user.id);
    await interaction.reply({
      content: '✅ You have accepted the **Kautis** Terms of Service.',
      ephemeral: true
    });
    return;
  }

  // Ticket create
  if (interaction.customId === 'create_ticket') {
    const guild = interaction.guild;
    const user = interaction.user;

    const channel = await guild.channels.create({
      name: `ticket-${user.username}`,
      type: ChannelType.GuildText,
      parent: TICKET_CATEGORY_ID,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        {
          id: user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        }
      ]
    });

    const embed = new EmbedBuilder()
      .setTitle('🎫 Ticket Created')
      .setColor(KAUTIS_PINK)
      .setDescription(
        `Welcome to your ticket, <@${user.id}>!\n\n` +
        `Please answer the following questions so we can assist you:\n\n` +
        `**1. What do you want to buy?**\n` +
        `**2. How much do you want to buy?**\n\n` +
        `Once you’ve answered, a staff member will join shortly.\n\n` +
        `Click **Close Ticket** when you're done.`
      )
      .setFooter({ text: 'Kautis • Ticket' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒')
    );

    await channel.send({ content: `<@${user.id}>`, embeds: [embed], components: [row] });
    await interaction.reply({ content: `Your ticket has been created: ${channel}`, ephemeral: true });
    return;
  }

  if (interaction.customId === 'close_ticket') {
    const channel = interaction.channel;
    await interaction.reply({ content: '🔒 Closing ticket in 3 seconds…', ephemeral: true });
    setTimeout(async () => {
      await channel.delete().catch(() => null);
    }, 3000);
    return;
  }

  // Buyer role
  if (interaction.customId === 'get_buyer_role') {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      return interaction.reply({ content: 'Could not find your member data.', ephemeral: true });
    }
    if (member.roles.cache.has(BUYER_ROLE_ID)) {
      return interaction.reply({ content: 'You already have the **Buyer** role.', ephemeral: true });
    }
    await member.roles.add(BUYER_ROLE_ID).catch(() => null);
    await interaction.reply({
      content: '🛒 You have been given the **Buyer** role. Thanks for purchasing at **Kautis**!',
      ephemeral: true
    });
    return;
  }

  // Start music session
  if (interaction.customId === 'start_music_session') {
    const guild = interaction.guild;
    const user = interaction.user;

    if (sessions.length >= MAX_SESSIONS) {
      return interaction.reply({
        content: '❌ There are already 10 active music sessions. Please try again later.',
        ephemeral: true
      });
    }

    if (findSessionByUser(guild.id, user.id)) {
      return interaction.reply({
        content: 'You already have an active music session.',
        ephemeral: true
      });
    }

    // Create private voice + text channels
    const voiceChannel = await guild.channels.create({
      name: `vc-${user.username}`,
      type: ChannelType.GuildVoice,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect] },
        {
          id: user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak
          ]
        }
      ]
    });

    const textChannel = await guild.channels.create({
      name: `text-vc-${user.username}`,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        {
          id: user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        }
      ]
    });

    const queueKey = voiceChannel.id;
    const queue = getOrCreateQueue(queueKey, guild, voiceChannel.id);

    // Connect bot to VC
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator
    });
    queue.connection = connection;
    connection.subscribe(queue.player);

    sessions.push({
      guildId: guild.id,
      userId: user.id,
      voiceChannelId: voiceChannel.id,
      textChannelId: textChannel.id,
      queueKey
    });

    await interaction.reply({
      content: `🎧 Your private music session has been created: ${voiceChannel} + ${textChannel}`,
      ephemeral: true
    });

    const embed = new EmbedBuilder()
      .setTitle('🎧 Private Music Session')
      .setColor(KAUTIS_PINK)
      .setDescription(
        `Welcome to your private music session, <@${user.id}>!\n\n` +
        `You are in **${voiceChannel.name}**.\n\n` +
        `**Send a message here with the song you want to play.**\n` +
        `You can paste a YouTube link or type a search term.`
      )
      .setFooter({ text: 'Kautis • Music Session' });

    await textChannel.send({ content: `<@${user.id}>`, embeds: [embed] });

    // Wait for first song request
    const filter = (m) => m.author.id === user.id;
    const collector = textChannel.createMessageCollector({ filter, time: 5 * 60 * 1000 });

    collector.on('collect', async (msg) => {
      const query = msg.content.trim();
      if (!query) return;

      let url = query;
      let info;
      try {
        if (!play.yt_validate(query)) {
          const results = await play.search(query, { limit: 1 });
          if (!results || results.length === 0) {
            return msg.reply('No results found for that search.');
          }
          url = results[0].url;
          info = results[0];
        } else {
          info = await play.video_info(query);
          url = info.video_details.url;
        }
      } catch (err) {
        console.error(err);
        return msg.reply('Failed to fetch that track.');
      }

      const song = {
        title: info.title,
        url,
        requestedBy: msg.author.tag
      };

      queue.songs.push(song);

      const added = new EmbedBuilder()
        .setTitle('🎵 Added to Queue')
        .setColor(KAUTIS_PINK)
        .setDescription(`**${song.title}**`)
        .addFields(
          { name: 'Requested by', value: song.requestedBy, inline: true },
          { name: 'Position in queue', value: `${queue.songs.length}`, inline: true }
        )
        .setFooter({ text: 'Kautis • Music' });

      await msg.reply({ embeds: [added] });

      if (!queue.playing) {
        playNext(queueKey);
      }
    });

    collector.on('end', () => {
      // no-op; session cleanup handled by voiceStateUpdate
    });
  }
});

// ---- LOGIN ----
client.login(DISCORD_TOKEN);
