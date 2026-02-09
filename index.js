const {
    Client,
    GatewayIntentBits,
    Partials,
    ActivityType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
    EmbedBuilder,
    PermissionsBitField,
    SlashCommandBuilder,
    REST,
    Routes
} = require("discord.js");
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

// ---------- CONFIG / IN-MEMORY DATA ----------
const ticketConfig = {
    supportRoleId: process.env.SUPPORT_ROLE_ID,
    ticketCategoryId: process.env.TICKET_CATEGORY_ID,
    logChannelId: process.env.LOG_CHANNEL_ID
};

const swearJar = new Map();          // userId -> coins
const economy = new Map();           // userId -> { balance, lastDaily }
const afkMap = new Map();            // userId -> { reason, since }
const giveaways = new Map();         // messageId -> { prize, endsAt, entrants: Set }

const badWords = ["badword1", "badword2", "badword3"]; // change these

// ---------- COMMAND REGISTRATION ----------
const commands = [
    new SlashCommandBuilder()
        .setName("ticketpanel")
        .setDescription("Send the D2R ticket panel"),
    new SlashCommandBuilder()
        .setName("swearjar")
        .setDescription("View D2R swear jar leaderboard"),
    new SlashCommandBuilder()
        .setName("eco")
        .setDescription("D2R economy commands")
        .addSubcommand(sub =>
            sub.setName("balance").setDescription("Check your balance")
        )
        .addSubcommand(sub =>
            sub.setName("daily").setDescription("Claim your daily reward")
        ),
    new SlashCommandBuilder()
        .setName("rps")
        .setDescription("Play rock-paper-scissors with D2R")
        .addStringOption(opt =>
            opt
                .setName("choice")
                .setDescription("Your choice")
                .setRequired(true)
                .addChoices(
                    { name: "Rock", value: "rock" },
                    { name: "Paper", value: "paper" },
                    { name: "Scissors", value: "scissors" }
                )
        ),
    new SlashCommandBuilder()
        .setName("rolespanel")
        .setDescription("Send the D2R role button panel"),
    new SlashCommandBuilder()
        .setName("mod")
        .setDescription("D2R moderation commands")
        .addSubcommand(sub =>
            sub
                .setName("ban")
                .setDescription("Ban a user")
                .addUserOption(opt =>
                    opt.setName("user").setDescription("User to ban").setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName("reason").setDescription("Reason").setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName("timeout")
                .setDescription("Timeout a user (minutes)")
                .addUserOption(opt =>
                    opt.setName("user").setDescription("User to timeout").setRequired(true)
                )
                .addIntegerOption(opt =>
                    opt.setName("minutes").setDescription("Duration in minutes").setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName("reason").setDescription("Reason").setRequired(false)
                )
        ),
    new SlashCommandBuilder()
        .setName("afk")
        .setDescription("Set your AFK status")
        .addStringOption(opt =>
            opt
                .setName("reason")
                .setDescription("Reason for AFK")
                .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName("gstart")
        .setDescription("Start a D2R giveaway")
        .addIntegerOption(opt =>
            opt
                .setName("minutes")
                .setDescription("Duration in minutes")
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt
                .setName("prize")
                .setDescription("Giveaway prize")
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName("gend")
        .setDescription("End a D2R giveaway")
        .addStringOption(opt =>
            opt
                .setName("messageid")
                .setDescription("Giveaway message ID")
                .setRequired(true)
        )
].map(c => c.toJSON());

// ---------- HELPERS ----------
function getEcoData(userId) {
    const data = economy.get(userId) || { balance: 0, lastDaily: 0 };
    economy.set(userId, data);
    return data;
}

// ---------- READY ----------
client.once("ready", async () => {
    console.log(`${client.user.tag} is online`);

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
    try {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
            { body: commands }
        );
        console.log("Slash commands registered.");
    } catch (err) {
        console.error("Error registering commands:", err);
    }

    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    let memberCount = 0;
    if (guild) {
        await guild.members.fetch();
        memberCount = guild.memberCount;
    }

    client.user.setActivity(`Watching ${memberCount} Members`, {
        type: ActivityType.Watching
    });
});

// ---------- INTERACTIONS ----------
client.on("interactionCreate", async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        // ----- TICKET PANEL -----
        if (commandName === "ticketpanel") {
            const embed = new EmbedBuilder()
                .setColor("#000000")
                .setTitle("D2R Support")
                .setDescription(
                    "> **What is this?**\n" +
                    "- The official support system for D2R.\n" +
                    "- Use this panel to open a private ticket.\n" +
                    "- Our team will assist you as soon as possible.\n\n" +
                    "> **When should you open a ticket?**\n" +
                    "- Account issues\n" +
                    "- Purchases / coins\n" +
                    "- Reports\n" +
                    "- Technical problems\n" +
                    "- General support\n\n" +
                    "> **How it works**\n" +
                    "- Click the button below.\n" +
                    "- A private channel will be created.\n" +
                    "- D2R staff will respond shortly.\n\n" +
                    "> **Rules**\n" +
                    "- Be respectful.\n" +
                    "- Do not ping staff.\n" +
                    "- Provide clear information.\n\n" +
                    "> **Status**\n" +
                    "- 🧪 Online\n" +
                    "- 💬 Accepting tickets"
                )
                .setFooter({ text: "D2R • Support Panel" });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("d2r-ticket-open")
                    .setLabel("Open D2R Ticket")
                    .setStyle(ButtonStyle.Primary)
            );

            return interaction.reply({
                content: "D2R ticket panel created:",
                embeds: [embed],
                components: [row]
            });
        }

        // ----- SWEAR JAR LEADERBOARD -----
        if (commandName === "swearjar") {
            const entries = [...swearJar.entries()];
            entries.sort((a, b) => b[1] - a[1]);
            const top = entries.slice(0, 10);

            let desc = "";
            if (top.length === 0) {
                desc = "- No fines recorded yet.";
            } else {
                top.forEach(([userId, amount], i) => {
                    desc += `- **#${i + 1}** <@${userId}> — ${amount} coins\n`;
                });
            }

            const embed = new EmbedBuilder()
                .setColor("#000000")
                .setTitle("D2R Swear Jar • Leaderboard")
                .setDescription(
                    "> **Top Fined Users**\n" +
                    `${desc}\n\n` +
                    "> **Note**\n" +
                    "- This resets when the bot restarts (no DB yet)."
                )
                .setFooter({ text: "D2R • Swear Jar" });

            return interaction.reply({ embeds: [embed] });
        }

        // ----- ECONOMY -----
        if (commandName === "eco") {
            const sub = interaction.options.getSubcommand();
            const userId = interaction.user.id;
            const data = getEcoData(userId);

            if (sub === "balance") {
                const embed = new EmbedBuilder()
                    .setColor("#000000")
                    .setTitle("D2R Economy • Balance")
                    .setDescription(
                        "> **User**\n" +
                        `- <@${userId}>\n\n` +
                        "> **Balance**\n" +
                        `- ${data.balance} coins`
                    )
                    .setFooter({ text: "D2R • Economy" });

                return interaction.reply({ embeds: [embed] });
            }

            if (sub === "daily") {
                const now = Date.now();
                const cooldown = 24 * 60 * 60 * 1000;

                if (now - data.lastDaily < cooldown) {
                    const remaining = cooldown - (now - data.lastDaily);
                    const hours = Math.floor(remaining / (60 * 60 * 1000));
                    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

                    return interaction.reply({
                        content: `You already claimed your daily. Try again in ${hours}h ${minutes}m.`,
                        ephemeral: true
                    });
                }

                const reward = 100;
                data.balance += reward;
                data.lastDaily = now;

                const embed = new EmbedBuilder()
                    .setColor("#000000")
                    .setTitle("D2R Economy • Daily")
                    .setDescription(
                        "> **Reward**\n" +
                        `- +${reward} coins\n\n` +
                        "> **New Balance**\n" +
                        `- ${data.balance} coins`
                    )
                    .setFooter({ text: "D2R • Economy" });

                return interaction.reply({ embeds: [embed] });
            }
        }

        // ----- RPS GAME -----
        if (commandName === "rps") {
            const choices = ["rock", "paper", "scissors"];
            const userChoice = interaction.options.getString("choice");
            const botChoice = choices[Math.floor(Math.random() * choices.length)];

            let resultText = "";
            if (userChoice === botChoice) resultText = "- It’s a draw.";
            else if (
                (userChoice === "rock" && botChoice === "scissors") ||
                (userChoice === "paper" && botChoice === "rock") ||
                (userChoice === "scissors" && botChoice === "paper")
            ) resultText = "- You win.";
            else resultText = "- You lose.";

            const embed = new EmbedBuilder()
                .setColor("#000000")
                .setTitle("D2R Game • Rock Paper Scissors")
                .setDescription(
                    "> **Choices**\n" +
                    `- You: **${userChoice}**\n` +
                    `- D2R: **${botChoice}**\n\n` +
                    "> **Result**\n" +
                    `${resultText}`
                )
                .setFooter({ text: "D2R • Games" });

            return interaction.reply({ embeds: [embed] });
        }

        // ----- ROLES PANEL -----
        if (commandName === "rolespanel") {
            const embed = new EmbedBuilder()
                .setColor("#000000")
                .setTitle("D2R Roles")
                .setDescription(
                    "> **What is this?**\n" +
                    "- Click the button below to toggle a role.\n\n" +
                    "> **Info**\n" +
                    "- This can be used for pings, regions, or game modes.\n\n" +
                    "> **Status**\n" +
                    "- 🧪 Active\n" +
                    "- 💬 Self-assignable"
                )
                .setFooter({ text: "D2R • Roles" });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("d2r-role-button")
                    .setLabel("Toggle Role")
                    .setStyle(ButtonStyle.Secondary)
            );

            return interaction.reply({
                content: "D2R role panel created:",
                embeds: [embed],
                components: [row]
            });
        }

        // ----- MODERATION -----
        if (commandName === "mod") {
            const sub = interaction.options.getSubcommand();

            if (sub === "ban") {
                const user = interaction.options.getUser("user");
                const reason = interaction.options.getString("reason") || "No reason provided";

                const member = await interaction.guild.members.fetch(user.id).catch(() => null);
                if (!member) {
                    return interaction.reply({
                        content: "User not found in this server.",
                        ephemeral: true
                    });
                }

                await member.ban({ reason }).catch(() => {
                    return interaction.reply({
                        content: "Failed to ban user.",
                        ephemeral: true
                    });
                });

                const embed = new EmbedBuilder()
                    .setColor("#000000")
                    .setTitle("D2R Moderation • Ban")
                    .setDescription(
                        "> **User**\n" +
                        `- ${user.tag} (<@${user.id}>)\n\n` +
                        "> **Reason**\n" +
                        `- ${reason}`
                    )
                    .setFooter({ text: "D2R • Moderation" });

                return interaction.reply({ embeds: [embed] });
            }

            if (sub === "timeout") {
                const user = interaction.options.getUser("user");
                const minutes = interaction.options.getInteger("minutes");
                const reason = interaction.options.getString("reason") || "No reason provided";

                const member = await interaction.guild.members.fetch(user.id).catch(() => null);
                if (!member) {
                    return interaction.reply({
                        content: "User not found in this server.",
                        ephemeral: true
                    });
                }

                const ms = minutes * 60 * 1000;

                await member.timeout(ms, reason).catch(() => {
                    return interaction.reply({
                        content: "Failed to timeout user.",
                        ephemeral: true
                    });
                });

                const embed = new EmbedBuilder()
                    .setColor("#000000")
                    .setTitle("D2R Moderation • Timeout")
                    .setDescription(
                        "> **User**\n" +
                        `- ${user.tag} (<@${user.id}>)\n\n` +
                        "> **Duration**\n" +
                        `- ${minutes} minutes\n\n` +
                        "> **Reason**\n" +
                        `- ${reason}`
                    )
                    .setFooter({ text: "D2R • Moderation" });

                return interaction.reply({ embeds: [embed] });
            }
        }

        // ----- AFK -----
        if (commandName === "afk") {
            const reason = interaction.options.getString("reason") || "AFK";
            afkMap.set(interaction.user.id, { reason, since: Date.now() });

            const embed = new EmbedBuilder()
                .setColor("#000000")
                .setTitle("D2R AFK")
                .setDescription(
                    "> **Status**\n" +
                    "- You are now marked as AFK.\n\n" +
                    "> **Reason**\n" +
                    `- ${reason}`
                )
                .setFooter({ text: "D2R • AFK" });

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // ----- GIVEAWAY START -----
        if (commandName === "gstart") {
            const minutes = interaction.options.getInteger("minutes");
            const prize = interaction.options.getString("prize");
            const endsAt = Date.now() + minutes * 60 * 1000;

            const embed = new EmbedBuilder()
                .setColor("#000000")
                .setTitle("D2R Giveaway")
                .setDescription(
                    "> **Prize**\n" +
                    `- ${prize}\n\n` +
                    "> **Hosted by**\n" +
                    `- <@${interaction.user.id}>\n\n` +
                    "> **How to enter**\n" +
                    "- Click the button below to join.\n\n" +
                    "> **Status**\n" +
                    `- 🧪 Running\n` +
                    `- ⏰ Ends in ${minutes} minutes`
                )
                .setFooter({ text: "D2R • Giveaways" });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("d2r-giveaway-enter")
                    .setLabel("Enter Giveaway")
                    .setStyle(ButtonStyle.Success)
            );

            const msg = await interaction.reply({
                embeds: [embed],
                components: [row],
                fetchReply: true
            });

            giveaways.set(msg.id, {
                prize,
                endsAt,
                entrants: new Set()
            });
        }

        // ----- GIVEAWAY END -----
        if (commandName === "gend") {
            const messageId = interaction.options.getString("messageid");
            const data = giveaways.get(messageId);
            if (!data) {
                return interaction.reply({
                    content: "Giveaway not found or already ended.",
                    ephemeral: true
                });
            }

            const entrants = [...data.entrants];
            let resultText = "";
            if (entrants.length === 0) {
                resultText = "- No valid entries.";
            } else {
                const winner = entrants[Math.floor(Math.random() * entrants.length)];
                resultText = `- Winner: <@${winner}>`;
            }

            giveaways.delete(messageId);

            const embed = new EmbedBuilder()
                .setColor("#000000")
                .setTitle("D2R Giveaway • Ended")
                .setDescription(
                    "> **Prize**\n" +
                    `- ${data.prize}\n\n` +
                    "> **Result**\n" +
                    `${resultText}`
                )
                .setFooter({ text: "D2R • Giveaways" });

            return interaction.reply({ embeds: [embed] });
        }
    }

    // ---------- BUTTONS ----------
    if (interaction.isButton()) {
        const { customId } = interaction;
        const guild = interaction.guild;

        // TICKET OPEN
        if (customId === "d2r-ticket-open") {
            if (!ticketConfig.ticketCategoryId || !ticketConfig.supportRoleId) {
                return interaction.reply({
                    content: "Ticket system is not configured correctly.",
                    ephemeral: true
                });
            }

            const existing = guild.channels.cache.find(
                ch =>
                    ch.name === `d2r-ticket-${interaction.user.id}` &&
                    ch.parentId === ticketConfig.ticketCategoryId
            );
            if (existing) {
                return interaction.reply({
                    content: `You already have an open ticket: ${existing}`,
                    ephemeral: true
                });
            }

            const channel = await guild.channels.create({
                name: `d2r-ticket-${interaction.user.id}`,
                parent: ticketConfig.ticketCategoryId,
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
                        id: ticketConfig.supportRoleId,
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
                content: `<@${interaction.user.id}> <@&${ticketConfig.supportRoleId}>`,
                embeds: [ticketEmbed],
                components: [row]
            });

            return interaction.reply({
                content: `Your ticket has been created: ${channel}`,
                ephemeral: true
            });
        }

        // TICKET CLOSE
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
                if (ticketConfig.logChannelId) {
                    const logChannel = interaction.guild.channels.cache.get(ticketConfig.logChannelId);
                    if (logChannel) {
                        await logChannel.send({
                            content: `D2R ticket ${channel.name} closed by <@${interaction.user.id}>`
                        });
                    }
                }
                await channel.delete().catch(() => {});
            }, 5000);
        }

        // TICKET TRANSCRIPT
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

            if (ticketConfig.logChannelId) {
                const logChannel = interaction.guild.channels.cache.get(ticketConfig.logChannelId);
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

        // ROLE BUTTON
        if (customId === "d2r-role-button") {
            const roleId = process.env.ROLE_BUTTON_ROLE_ID;
            const member = interaction.member;

            if (!roleId) {
                return interaction.reply({
                    content: "Role button is not configured.",
                    ephemeral: true
                });
            }

            const role = interaction.guild.roles.cache.get(roleId);
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

        // GIVEAWAY ENTER
        if (customId === "d2r-giveaway-enter") {
            const data = giveaways.get(interaction.message.id);
            if (!data) {
                return interaction.reply({
                    content: "This giveaway is no longer active.",
                    ephemeral: true
                });
            }

            if (Date.now() > data.endsAt) {
                return interaction.reply({
                    content: "This giveaway has already ended.",
                    ephemeral: true
                });
            }

            data.entrants.add(interaction.user.id);
            return interaction.reply({
                content: "You have entered the giveaway.",
                ephemeral: true
            });
        }
    }
});

// ---------- MESSAGE EVENTS (SWEAR JAR + AFK + LOGGING) ----------
client.on("messageCreate", async message => {
    if (!message.guild || message.author.bot) return;

    const contentLower = message.content.toLowerCase();

    // Swear jar
    if (badWords.some(w => contentLower.includes(w))) {
        await message.delete().catch(() => {});

        const current = swearJar.get(message.author.id) || 0;
        const fine = 10;
        swearJar.set(message.author.id, current + fine);

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

    // AFK clear on message
    if (afkMap.has(message.author.id)) {
        afkMap.delete(message.author.id);
        const embed = new EmbedBuilder()
            .setColor("#000000")
            .setTitle("D2R AFK")
            .setDescription(
                "> **Status**\n" +
                "- You are no longer AFK."
            )
            .setFooter({ text: "D2R • AFK" });

        await message.reply({ embeds: [embed] }).catch(() => {});
    }

    // AFK mention check
    if (message.mentions.users.size > 0) {
        for (const [id] of message.mentions.users) {
            if (afkMap.has(id)) {
                const data = afkMap.get(id);
                const embed = new EmbedBuilder()
                    .setColor("#000000")
                    .setTitle("D2R AFK")
                    .setDescription(
                        "> **User is AFK**\n" +
                        `- <@${id}>\n\n` +
                        "> **Reason**\n" +
                        `- ${data.reason}`
                    )
                    .setFooter({ text: "D2R • AFK" });

                await message.reply({ embeds: [embed] }).catch(() => {});
                break;
            }
        }
    }
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

// ---------- WELCOME / JOIN / LEAVE ----------
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

// ---------- LOGIN ----------
client.login(process.env.TOKEN);

