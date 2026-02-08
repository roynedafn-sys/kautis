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
const path = require("path");
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

/* =======================
   LOAD COMMANDS SAFELY
======================= */
const commandsPath = path.join(__dirname, "commands");

if (fs.existsSync(commandsPath)) {
    const commandFiles = fs
        .readdirSync(commandsPath)
        .filter(file => file.endsWith(".js"));

    for (const file of commandFiles) {
        const command = require(path.join(commandsPath, file));
        if (command?.data?.name && command?.execute) {
            client.commands.set(command.data.name, command);
        }
    }
    console.log(`✅ Loaded ${client.commands.size} commands`);
} else {
    console.warn("⚠️  commands folder not found — skipping command loading");
}

/* =======================
   TICKET CONFIG
======================= */
client.ticketConfig = {
    supportRoleId: "SUPPORT_ROLE_ID_HERE",
    ticketCategoryId: "TICKET_CATEGORY_ID_HERE",
    logChannelId: "LOG_CHANNEL_ID_HERE"
};

/* =======================
   INTERACTIONS
======================= */
client.on("interactionCreate", async interaction => {

    /* ---- SLASH COMMANDS ---- */
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, client);
        } catch (err) {
            console.error(err);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: "❌ There was an error executing this command.",
                    ephemeral: true
                });
            }
        }
    }

    /* ---- BUTTONS ---- */
    if (!interaction.isButton()) return;
    const { customId } = interaction;

    /* OPEN TICKET */
    if (customId === "ticket-open") {
        const { ticketCategoryId, supportRoleId } = client.ticketConfig;
        const guild = interaction.guild;

        if (!ticketCategoryId || !supportRoleId) {
            return interaction.reply({
                content: "❌ Ticket system is not configured.",
                ephemeral: true
            });
        }

        const existing = guild.channels.cache.find(
            ch =>
                ch.name === `ticket-${interaction.user.id}` &&
                ch.parentId === ticketCategoryId
        );

        if (existing) {
            return interaction.reply({
                content: `❌ You already have a ticket: ${existing}`,
                ephemeral: true
            });
        }

        const channel = await guild.channels.create({
            name: `ticket-${interaction.user.id}`,
            parent: ticketCategoryId,
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
                    id: supportRoleId,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.ManageMessages
                    ]
                }
            ]
        });

        const embed = new EmbedBuilder()
            .setColor("#000000")
            .setTitle("🎫 Ticket Created")
            .setDescription(
                `> **User**\n- <@${interaction.user.id}>\n\n` +
                `> **Instructions**\n- Describe your issue clearly\n- Staff will respond soon\n\n` +
                `> **Status**\n- 🟢 Open`
            )
            .setFooter({ text: "Advanced Ticket System" });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("ticket-close")
                .setLabel("Close Ticket")
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId("ticket-transcript")
                .setLabel("Save Transcript")
                .setStyle(ButtonStyle.Secondary)
        );

        await channel.send({
            content: `<@${interaction.user.id}> <@&${supportRoleId}>`,
            embeds: [embed],
            components: [row]
        });

        return interaction.reply({
            content: `✅ Ticket created: ${channel}`,
            ephemeral: true
        });
    }

    /* CLOSE TICKET */
    if (customId === "ticket-close") {
        const channel = interaction.channel;

        if (!channel.name.startsWith("ticket-")) {
            return interaction.reply({
                content: "❌ This is not a ticket channel.",
                ephemeral: true
            });
        }

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor("#000000")
                    .setTitle("🔒 Ticket Closed")
                    .setDescription(`Closed by <@${interaction.user.id}>`)
            ]
        });

        setTimeout(async () => {
            await channel.delete().catch(() => {});
        }, 5000);
    }

    /* TRANSCRIPT */
    if (customId === "ticket-transcript") {
        const channel = interaction.channel;
        const { logChannelId } = client.ticketConfig;

        if (!channel.name.startsWith("ticket-")) {
            return interaction.reply({
                content: "❌ This is not a ticket channel.",
                ephemeral: true
            });
        }

        const messages = await channel.messages.fetch({ limit: 100 });
        const sorted = [...messages.values()].sort(
            (a, b) => a.createdTimestamp - b.createdTimestamp
        );

        let text = `Transcript for ${channel.name}\n\n`;

        for (const msg of sorted) {
            text += `[${new Date(msg.createdTimestamp).toISOString()}] ${
                msg.author.tag
            }: ${msg.content || "[attachment]"}\n`;
        }

        const file = new AttachmentBuilder(
            Buffer.from(text, "utf-8"),
            { name: `${channel.name}-transcript.txt` }
        );

        if (logChannelId) {
            const logChannel = interaction.guild.channels.cache.get(logChannelId);
            if (logChannel) {
                await logChannel.send({ files: [file] });
            }
        }

        return interaction.reply({
            content: "📄 Transcript saved.",
            ephemeral: true
        });
    }
});

/* =======================
   READY
======================= */
client.on("ready", async () => {
    console.log(`🤖 ${client.user.tag} is online`);

    client.user.setActivity("Watching members", {
        type: ActivityType.Watching
    });
});

client.login(process.env.TOKEN);




