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

// Load commands
const commandFiles = fs.readdirSync("./commands").filter(file => file.endsWith(".js"));
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
}

// Ticket config (per bot for now – you can later move to DB)
client.ticketConfig = {
    supportRoleId: "SUPPORT_ROLE_ID_HERE",
    ticketCategoryId: "TICKET_CATEGORY_ID_HERE",
    logChannelId: "LOG_CHANNEL_ID_HERE"
};

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
                await interaction.reply({ content: "There was an error executing this command.", ephemeral: true });
            }
        }
    }

    // Buttons
    if (interaction.isButton()) {
        const { customId } = interaction;

        // Open ticket
        if (customId === "ticket-open") {
            const config = client.ticketConfig;
            const guild = interaction.guild;

            if (!config.ticketCategoryId || !config.supportRoleId) {
                return interaction.reply({
                    content: "Ticket system is not configured correctly.",
                    ephemeral: true
                });
            }

            // Check if user already has a ticket
            const existing = guild.channels.cache.find(
                ch =>
                    ch.name === `ticket-${interaction.user.id}` &&
                    ch.parentId === config.ticketCategoryId
            );
            if (existing) {
                return interaction.reply({
                    content: `You already have an open ticket: ${existing}`,
                    ephemeral: true
                });
            }

            const channel = await guild.channels.create({
                name: `ticket-${interaction.user.id}`,
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
                .setTitle("Ticket Created")
                .setDescription(
                    `> **User**\n` +
                    `- <@${interaction.user.id}>\n\n` +
                    `> **Instructions**\n` +
                    `- Describe your issue in detail.\n` +
                    `- A staff member will respond shortly.\n` +
                    `- Use the buttons below to manage this ticket.\n\n` +
                    `> **Status**\n` +
                    `- 🧪 Open\n` +
                    `- 💬 Waiting for staff`
                )
                .setFooter({ text: "Advanced Ticket System • ticket" });

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
        if (customId === "ticket-close") {
            const channel = interaction.channel;
            const config = client.ticketConfig;

            if (!channel.name.startsWith("ticket-")) {
                return interaction.reply({ content: "This is not a ticket channel.", ephemeral: true });
            }

            const closeEmbed = new EmbedBuilder()
                .setColor("#000000")
                .setTitle("Ticket Closed")
                .setDescription(
                    `> **Closed by**\n` +
                    `- <@${interaction.user.id}>\n\n` +
                    `> **Status**\n` +
                    `- 💀 Closed\n` +
                    `- 🧾 Transcript can be saved before deletion`
                )
                .setFooter({ text: "Advanced Ticket System • closed" });

            await interaction.reply({ embeds: [closeEmbed] });

            // Optional: delay delete
            setTimeout(async () => {
                // Log closure
                if (config.logChannelId) {
                    const logChannel = interaction.guild.channels.cache.get(config.logChannelId);
                    if (logChannel) {
                        await logChannel.send({
                            content: `Ticket ${channel.name} closed by <@${interaction.user.id}>`
                        });
                    }
                }
                await channel.delete().catch(() => {});
            }, 5000);
        }

        // Transcript
        if (customId === "ticket-transcript") {
            const channel = interaction.channel;
            const config = client.ticketConfig;

            if (!channel.name.startsWith("ticket-")) {
                return interaction.reply({ content: "This is not a ticket channel.", ephemeral: true });
            }

            const messages = await channel.messages.fetch({ limit: 100 });
            const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

            let content = `Transcript for #${channel.name}\nGuild: ${interaction.guild.name}\n\n`;

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
            const file = new AttachmentBuilder(buffer, { name: `${channel.name}-transcript.txt` });

            if (config.logChannelId) {
                const logChannel = interaction.guild.channels.cache.get(config.logChannelId);
                if (logChannel) {
                    await logChannel.send({
                        content: `Transcript for ${channel} requested by <@${interaction.user.id}>`,
                        files: [file]
                    });
                }
            }

            return interaction.reply({
                content: "Transcript has been saved to the log channel.",
                ephemeral: true
            });
        }
    }
});

client.on("ready", async () => {
    console.log(`${client.user.tag} is online`);

    const guild = client.guilds.cache.get("YOUR_SERVER_ID_HERE");
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


