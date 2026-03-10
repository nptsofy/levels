const {
    Client,
    GatewayIntentBits,
    Partials,
    AttachmentBuilder,
    REST,
    Routes
} = require("discord.js");
const Canvas = require("canvas");
const { QuickDB } = require("quick.db");

const db = new QuickDB();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel]
});

const PREFIX = "!";
const XP_PER_MESSAGE = 15;
const XP_COOLDOWN = 10 * 1000; // 10s
const GUILD_ID = "1470121923240395005";

const cooldowns = new Map();

// ===== LEVEL FORMULA =====
function getRequiredXP(level) {
    return 5 * (level ** 2) + 50 * level + 100;
}

// ===== RANK CARD GENERATOR =====
async function generateRankCard({ username, avatarURL, level, rank, currentXP, requiredXP }) {
    const width = 1000;
    const height = 300;

    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // Background (solid dark red/black)
    ctx.fillStyle = "#0A0204";
    ctx.fillRect(0, 0, width, height);

    // Avatar
    const avatar = await Canvas.loadImage(avatarURL);
    const avatarSize = 220;

    ctx.save();
    ctx.beginPath();
    ctx.arc(160, height / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, 50, height / 2 - avatarSize / 2, avatarSize, avatarSize);
    ctx.restore();

    // Text
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "left";

    ctx.font = "40px Sans-serif";
    ctx.fillText(username, 300, 90);

    ctx.font = "32px Sans-serif";
    ctx.fillText(`Level: ${level}`, 300, 150);
    ctx.fillText(`Rank: ${rank}`, 300, 200);

    ctx.font = "28px Sans-serif";
    ctx.fillText(`${currentXP} / ${requiredXP} XP`, 300, 240);

    // XP bar
    const barX = 300;
    const barY = 260;
    const barWidth = 650;
    const barHeight = 30;

    // Background bar
    ctx.fillStyle = "#1A0A0D";
    roundRect(ctx, barX, barY, barWidth, barHeight, 15);
    ctx.fill();

    // Fill
    const xpPercent = Math.min(currentXP / requiredXP, 1);
    const fillWidth = barWidth * xpPercent;

    const gradient = ctx.createLinearGradient(barX, 0, barX + fillWidth, 0);
    gradient.addColorStop(0, "#8D052C");
    gradient.addColorStop(1, "#25030B");

    ctx.fillStyle = gradient;
    roundRect(ctx, barX, barY, fillWidth, barHeight, 15);
    ctx.fill();

    // Glow
    ctx.shadowColor = "#8D052C";
    ctx.shadowBlur = 25;
    roundRect(ctx, barX, barY, fillWidth, barHeight, 15);
    ctx.fill();
    ctx.shadowBlur = 0;

    return canvas.toBuffer();
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// ===== XP HANDLER (messages) =====
client.on("messageCreate", async (message) => {
    if (!message.guild || message.author.bot) return;

    const userId = message.author.id;
    const key = `${message.guild.id}.${userId}`;

    // Cooldown
    const now = Date.now();
    const last = cooldowns.get(key) || 0;
    if (now - last < XP_COOLDOWN) return;
    cooldowns.set(key, now);

    // Get data
    let data = await db.get(key);
    if (!data) data = { xp: 0, level: 0 };

    data.xp += XP_PER_MESSAGE;

    // Level up
    let leveledUp = false;
    while (data.xp >= getRequiredXP(data.level)) {
        data.xp -= getRequiredXP(data.level);
        data.level++;
        leveledUp = true;
    }

    await db.set(key, data);

    if (leveledUp) {
        message.channel.send(`🎉 ${message.author} leveled up to **Level ${data.level}**!`);
    }

    // Prefix commands
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = args.shift()?.toLowerCase();

    if (cmd === "level" || cmd === "rank") {
        await handleRank(message, message.author);
    }

    if (cmd === "leaderboard" || cmd === "lb") {
        await handleLeaderboard(message);
    }
});

// ===== RANK LOGIC =====
async function getUserDataAndRank(guild, userId) {
    const guildId = guild.id;
    const all = await db.all();

    const users = all
        .filter(e => e.id.startsWith(guildId + "."))
        .map(e => ({
            id: e.id.split(".")[1],
            xp: e.value.xp || 0,
            level: e.value.level || 0
        }));

    users.sort((a, b) => (b.level === a.level ? b.xp - a.xp : b.level - a.level));

    const userData = users.find(u => u.id === userId) || { xp: 0, level: 0 };
    const rank = users.findIndex(u => u.id === userId) + 1 || users.length || 1;

    return { userData, rank, users };
}

async function handleRank(message, user) {
    const { userData, rank } = await getUserDataAndRank(message.guild, user.id);

    const level = userData.level;
    const currentXP = userData.xp;
    const requiredXP = getRequiredXP(level);

    const buffer = await generateRankCard({
        username: user.username,
        avatarURL: user.displayAvatarURL({ extension: "png", size: 256 }),
        level,
        rank,
        currentXP,
        requiredXP
    });

    const attachment = new AttachmentBuilder(buffer, { name: "rank.png" });

    await message.channel.send({ files: [attachment] });
}

async function handleLeaderboard(message) {
    const { users } = await getUserDataAndRank(message.guild, message.author.id);

    const top = users.slice(0, 10);

    if (!top.length) {
        return message.channel.send("No one has XP yet.");
    }

    let text = "🏆 **Leaderboard**\n\n";
    for (let i = 0; i < top.length; i++) {
        const u = await message.client.users.fetch(top[i].id).catch(() => null);
        const name = u ? u.username : "Unknown";
        text += `**#${i + 1}** - ${name} — Level ${top[i].level} (${top[i].xp} XP)\n`;
    }

    message.channel.send(text);
}

// ===== SLASH COMMANDS =====
const slashCommands = [
    {
        name: "level",
        description: "Show your level card"
    },
    {
        name: "rank",
        description: "Show your level card"
    },
    {
        name: "leaderboard",
        description: "Show the server leaderboard"
    }
];

client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // Register guild slash commands
    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    try {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, GUILD_ID),
            { body: slashCommands }
        );
        console.log("Slash commands registered (guild).");
    } catch (err) {
        console.error("Error registering slash commands:", err);
    }
});

// Slash interaction handler
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "level" || interaction.commandName === "rank") {
        const user = interaction.user;
        const { userData, rank } = await getUserDataAndRank(interaction.guild, user.id);

        const level = userData.level;
        const currentXP = userData.xp;
        const requiredXP = getRequiredXP(level);

        const buffer = await generateRankCard({
            username: user.username,
            avatarURL: user.displayAvatarURL({ extension: "png", size: 256 }),
            level,
            rank,
            currentXP,
            requiredXP
        });

        const attachment = new AttachmentBuilder(buffer, { name: "rank.png" });

        await interaction.reply({ files: [attachment] });
    }

    if (interaction.commandName === "leaderboard") {
        const { users } = await getUserDataAndRank(interaction.guild, interaction.user.id);

        const top = users.slice(0, 10);

        if (!top.length) {
            return interaction.reply("No one has XP yet.");
        }

        let text = "🏆 **Leaderboard**\n\n";
        for (let i = 0; i < top.length; i++) {
            const u = await interaction.client.users.fetch(top[i].id).catch(() => null);
            const name = u ? u.username : "Unknown";
            text += `**#${i + 1}** - ${name} — Level ${top[i].level} (${top[i].xp} XP)\n`;
        }

        await interaction.reply(text);
    }
});

// ===== LOGIN =====
client.login(process.env.DISCORD_TOKEN);