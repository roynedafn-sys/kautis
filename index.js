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

// Create client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

// Collections
client.commands = new Collection();

// Load commands from ./commands
const commandFiles = fs.readdirSync("./commands").filter(file => file.endsWith(".js"));
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
}

// Ticket config from env
client.ticketConfig = {
    supportRoleId: process.env.SUPPORT_ROLE_ID,
    ticketCategoryId: process.env.TICKET_CATEGORY_ID,
    logChannelId: process.env.LOG_CHANNEL_ID
};

// Handle interactions
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
        const config = client.ticketConfig;
        const guild = interaction.guild;

        // Open ticket
        if (customId === "d2r-ticket-open") {
            if (!config.ticketCategoryId || !config.supportRoleId) {
                return interaction.reply({
                    content: "Ticket system is not configured correctly.",
                    ephemeral: true
                });
            }

            // Check if user already has a ticket
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

            const config = client.ticketConfig;

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
            const config = client.ticketConfig;

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
    }
});

// Ready event
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


