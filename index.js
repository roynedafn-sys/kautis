const {
    Client,
    GatewayIntentBits,
    Partials,
    Collection,
    ActivityType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
    EmbedBuilder,
    PermissionsBitField
} = require("discord.js");
const fs = require("fs");
require("dotenv").config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

client.commands = new Collection();

// In-memory data (resets on restart – good enough to start)
client.ticketConfig = {
    supportRoleId: process.env.SUPPORT_ROLE_ID,
    ticketCategoryId: process.env.TICKET_CATEGORY_ID,
    logChannelId: process.env.LOG_CHANNEL_ID
};
client.swearJar = new Map();   // userId -> coins
client.economy = new Map();    // userId -> { balance, lastDaily }

// Load commands
const commandFiles = fs.readdirSync("./commands").filter(file => file.endsWith(".js"));
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
}

// ---------- INTERACTIONS (SLASH + BUTTONS) ----------
client.on("interactionCreate", async interaction => {
    // Slash commands
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, client);
        } catch (err) {
            console.error(err);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: "There was an error executing this command.",
                    ephemeral: true
                });
            }
        }
    }

    // Buttons
    if (interaction.isButton()) {
        const { customId } = interaction;
        const guild = interaction.guild;

        // ----- D2R Ticket System -----
        const config = client.ticketConfig;

        // Open ticket
        if (customId === "d2r-ticket-open") {
            if (!config.ticketCategoryId || !config.supportRoleId) {
                return interaction.reply({
                    content: "Ticket system is not configured correctly.",
                    ephemeral: true
                });
            }

            const existing = guild.channels.cache.find(
                ch =>
                    ch.name === `d2r-ticket-${interaction.user.id}` &&
                    ch.parentId === config.ticketCategoryId
            );
            if (existing) {
                return interaction.reply({
                    content: `You already have an open ticket: ${existing}`,
                    ephemeral: true
                });
            }

            const channel = await guild.channels.create({
                name: `d2r-ticket-${interaction.user.id}`,
                parent: config.ticketCategoryId,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    },
                    {
                        id: interaction.user.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory
                        ]
                    },
                    {
                        id: config.supportRoleId,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory,
                            PermissionsBitField.Flags.ManageMessages
                        ]
                    }
                ]
            });

            const ticketEmbed = new EmbedBuilder()
                .setColor("#000000")
                .setTitle("D2R Ticket Created")
                .setDescription(
                    "> **User**\n" +
                    `- <@${interaction.user.id}>\n\n` +
                    "> **Instructions**\n" +
                    "- Describe your issue in detail.\n" +
                    "- Include any relevant IDs, screenshots, or proof.\n" +
                    "- A D2R staff member will respond shortly.\n\n" +
                    "> **Status**\n" +
                    "- 🧪 Open\n" +
                    "- 💬 Waiting for staff"
                )
                .setFooter({ text: "D2R • Ticket Channel" });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("d2r-ticket-close")
                    .setLabel("Close Ticket")
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId("d2r-ticket-transcript")
                    .setLabel("Save Transcript")
                    .setStyle(ButtonStyle.Secondary)
            );

            await channel.send({
                content: `<@${interaction.user.id}> <@&${config.supportRoleId}>`,
                embeds: [ticketEmbed],
                components: [row]
            });

            return interaction.reply({
                content: `Your ticket has been created: ${channel}`,
                ephemeral: true
            });
        }

        // Close ticket
        if (customId === "d2r-ticket-close") {
            const channel = interaction.channel;

            if (!channel.name.startsWith("d2r-ticket-")) {
                return interaction.reply({
                    content: "This is not a D2R ticket channel.",
                    ephemeral: true
                });
            }

            const closeEmbed = new EmbedBuilder()
                .setColor("#000000")
                .setTitle("D2R Ticket Closed")
                .setDescription(
                    "> **Closed by**\n" +
                    `- <@${interaction.user.id}>\n\n` +
                    "> **Status**\n" +
                    "- 💀 Closed\n" +
                    "- 🧾 Transcript can be saved before deletion\n\n" +
                    "> **Note**\n" +
                    "- This channel will be deleted shortly."
                )
                .setFooter({ text: "D2R • Ticket Closed" });

            await interaction.reply({ embeds: [closeEmbed] });

            setTimeout(async () => {
                if (config.logChannelId) {
                    const logChannel = interaction.guild.channels.cache.get(config.logChannelId);
                    if (logChannel) {
                        await logChannel.send({
                            content: `D2R ticket ${channel.name} closed by <@${interaction.user.id}>`
                        });
                    }
                }
                await channel.delete().catch(() => {});
            }, 5000);
        }

        // Transcript
        if (customId === "d2r-ticket-transcript") {
            const channel = interaction.channel;

            if (!channel.name.startsWith("d2r-ticket-")) {
                return interaction.reply({
                    content: "This is not a D2R ticket channel.",
                    ephemeral: true
                });
            }

            const messages = await channel.messages.fetch({ limit: 100 });
            const sorted = [...messages.values()].sort(
                (a, b) => a.createdTimestamp - b.createdTimestamp
            );

            let content = `D2R Transcript for #${channel.name}\nGuild: ${interaction.guild.name}\n\n`;

            for (const msg of sorted) {
                const time = new Date(msg.createdTimestamp).toISOString();
                const author = `${msg.author.tag} (${msg.author.id})`;
                const line = `[${time}] ${author}: ${msg.content || "[embed/attachment]"}\n`;
                if (content.length + line.length < 190000) {
                    content += line;
                } else {
                    content += "\n[Transcript truncated due to length]\n";
                    break;
                }
            }

            const buffer = Buffer.from(content, "utf-8");
            const file = new AttachmentBuilder(buffer, {
                name: `${channel.name}-transcript.txt`
            });

            if (config.logChannelId) {
                const logChannel = interaction.guild.channels.cache.get(config.logChannelId);
                if (logChannel) {
                    await logChannel.send({
                        content: `D2R transcript for ${channel} requested by <@${interaction.user.id}>`,
                        files: [file]
                    });
                }
            }

            return interaction.reply({
                content: "Transcript has been saved to the D2R log channel.",
                ephemeral: true
            });
        }

        // ----- Role Button -----
        if (customId === "d2r-role-button") {
            const roleId = process.env.ROLE_BUTTON_ROLE_ID;
            const member = interaction.member;

            if (!roleId) {
                return interaction.reply({
                    content: "Role button is not configured.",
                    ephemeral: true
                });
            }

            const role = guild.roles.cache.get(roleId);
            if (!role) {
                return interaction.reply({
                    content: "Configured role does not exist.",
                    ephemeral: true
                });
            }

            if (member.roles.cache.has(roleId)) {
                await member.roles.remove(roleId);
                return interaction.reply({
                    content: `Role removed: <@&${roleId}>`,
                    ephemeral: true
                });
            } else {
                await member.roles.add(roleId);
                return interaction.reply({
                    content: `Role added: <@&${roleId}>`,
                    ephemeral: true
                });
            }
        }
    }
});

// ---------- MESSAGE EVENTS (SWEAR JAR + LOGGING) ----------
const badWords = ["badword1", "badword2", "badword3"]; // change these

client.on("messageCreate", async message => {
    if (!message.guild || message.author.bot) return;

    const contentLower = message.content.toLowerCase();

    // Swear jar
    if (badWords.some(w => contentLower.includes(w))) {
        await message.delete().catch(() => {});

        const current = client.swearJar.get(message.author.id) || 0;
        const fine = 10;
        client.swearJar.set(message.author.id, current + fine);

        const embed = new EmbedBuilder()
            .setColor("#000000")
            .setTitle("D2R Swear Jar")
            .setDescription(
                "> **Warning**\n" +
                "- Inappropriate language detected.\n\n" +
                "> **Fine Applied**\n" +
                `- User: <@${message.author.id}>\n` +
                `- Fine: ${fine} coins\n` +
                `- Total: ${current + fine} coins\n\n` +
                "> **Note**\n" +
                "- Repeated violations may lead to moderation actions."
            )
            .setFooter({ text: "D2R • Swear Jar" });

        await message.channel.send({ embeds: [embed] }).catch(() => {});
    }

    // Basic message delete logging is handled in messageDelete below
});

// Message delete logging
client.on("messageDelete", async message => {
    if (!message.guild || message.author?.bot) return;
    const logChannelId = process.env.LOG_CHANNEL_ID;
    const logChannel = message.guild.channels.cache.get(logChannelId);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setColor("#000000")
        .setTitle("D2R Log • Message Deleted")
        .setDescription(
            "> **User**\n" +
            `- ${message.author.tag} (<@${message.author.id}>)\n\n` +
            "> **Channel**\n" +
            `- <#${message.channel.id}>\n\n` +
            "> **Content**\n" +
            `- ${message.content || "[no content / embed / attachment]"}`
        )
        .setFooter({ text: "D2R • Logging" });

    await logChannel.send({ embeds: [embed] }).catch(() => {});
});

// Message edit logging
client.on("messageUpdate", async (oldMsg, newMsg) => {
    if (!newMsg.guild || newMsg.author?.bot) return;
    if (oldMsg.content === newMsg.content) return;

    const logChannelId = process.env.LOG_CHANNEL_ID;
    const logChannel = newMsg.guild.channels.cache.get(logChannelId);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setColor("#000000")
        .setTitle("D2R Log • Message Edited")
        .setDescription(
            "> **User**\n" +
            `- ${newMsg.author.tag} (<@${newMsg.author.id}>)\n\n` +
            "> **Channel**\n" +
            `- <#${newMsg.channel.id}>\n\n` +
            "> **Before**\n" +
            `- ${oldMsg.content || "[no content]"}\n\n` +
            "> **After**\n" +
            `- ${newMsg.content || "[no content]"}`
        )
        .setFooter({ text: "D2R • Logging" });

    await logChannel.send({ embeds: [embed] }).catch(() => {});
});

// ---------- WELCOME SYSTEM ----------
client.on("guildMemberAdd", async member => {
    const welcomeChannelId = process.env.WELCOME_CHANNEL_ID;
    const welcomeRoleId = process.env.WELCOME_ROLE_ID;

    if (welcomeRoleId) {
        const role = member.guild.roles.cache.get(welcomeRoleId);
        if (role) {
            await member.roles.add(role).catch(() => {});
        }
    }

    if (welcomeChannelId) {
        const channel = member.guild.channels.cache.get(welcomeChannelId);
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor("#000000")
                .setTitle("D2R Welcome")
                .setDescription(
                    "> **New Member Joined**\n" +
                    `- <@${member.id}>\n\n` +
                    "> **Info**\n" +
                    "- Welcome to D2R.\n" +
                    "- Read the rules.\n" +
                    "- Enjoy your stay.\n\n" +
                    "> **Status**\n" +
                    "- 🧪 Active\n" +
                    "- 💬 Community growing"
                )
                .setFooter({ text: "D2R • Welcome" });

            await channel.send({ embeds: [embed] }).catch(() => {});
        }
    }

    // Log join
    const logChannelId = process.env.LOG_CHANNEL_ID;
    const logChannel = member.guild.channels.cache.get(logChannelId);
    if (logChannel) {
        const embed = new EmbedBuilder()
            .setColor("#000000")
            .setTitle("D2R Log • Member Joined")
            .setDescription(
                "> **User**\n" +
                `- ${member.user.tag} (<@${member.id}>)`
            )
            .setFooter({ text: "D2R • Logging" });
        await logChannel.send({ embeds: [embed] }).catch(() => {});
    }
});

client.on("guildMemberRemove", async member => {
    const logChannelId = process.env.LOG_CHANNEL_ID;
    const logChannel = member.guild.channels.cache.get(logChannelId);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setColor("#000000")
        .setTitle("D2R Log • Member Left")
        .setDescription(
            "> **User**\n" +
            `- ${member.user?.tag || "Unknown"} (<@${member.id}>)`
        )
        .setFooter({ text: "D2R • Logging" });

    await logChannel.send({ embeds: [embed] }).catch(() => {});
});

// ---------- READY ----------
client.on("ready", async () => {
    console.log(`${client.user.tag} is online`);

    const guildId = process.env.GUILD_ID;
    const guild = client.guilds.cache.get(guildId);
    let memberCount = 0;

    if (guild) {
        await guild.members.fetch();
        memberCount = guild.memberCount;
    }

    client.user.setActivity(`Watching ${memberCount} Members`, {
        type: ActivityType.Watching
    });
});

client.login(process.env.TOKEN);




