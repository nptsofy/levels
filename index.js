require("dotenv").config();

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
const XP_COOLDOWN = 10 * 1000;
const GUILD_ID = "1470121923240395005";

const cooldowns = new Map();

// XP formula
function getRequiredXP(level) {
    return 5 * (level ** 2) + 50 * level + 100;
}

// ===== PREMIUM RED RANK CARD =====
async function generateRankCard({ username, avatarURL, level, rank, currentXP, requiredXP }) {
    const width = 1000;
    const height = 350;

    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // Red gradient background
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#2A0004"); // deep dark red
    gradient.addColorStop(1, "#5A000A"); // rich crimson
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Avatar with subtle red glow
    const avatar = await Canvas.loadImage(avatarURL);
    const avatarSize = 200;

    ctx.save();
    ctx.shadowColor = "rgba(255, 0, 60, 0.35)";
    ctx.shadowBlur = 25;

    ctx.beginPath();
    ctx.arc(150, height / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, 50, height / 2 - avatarSize / 2, avatarSize, avatarSize);

    ctx.restore();

    // TEXT
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "left";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 8;

    // Username
    ctx.font = "50px Sans-serif";
    ctx.fillText(username, 300, 100);

    // Level + Rank
    ctx.font = "32px Sans-serif";
    ctx.fillText(`LVL ${level}   RANK ${rank}`, 300, 150);

    // XP text
    ctx.font = "28px Sans-serif";
    ctx.fillText(`${currentXP} / ${requiredXP} xp`, 300, 200);

    // XP BAR
    const barX = 300;
    const barY = 240;
    const barWidth = 650;
    const barHeight = 35;

    // Background bar
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    roundRect(ctx, barX, barY, barWidth, barHeight, 15);
    ctx.fill();

    // Fill bar (flat neon red)
    const xpPercent = Math.min(currentXP / requiredXP, 1);
    const fillWidth = barWidth * xpPercent;

    ctx.fillStyle = "#FF003C"; // neon red
    roundRect(ctx, barX, barY, fillWidth, barHeight, 15);
    ctx.fill();

    // Glow
    ctx.shadowColor = "rgba(255, 0, 60, 0.45)";
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

// ===== XP HANDLER =====
client.on("messageCreate", async (message) => {
    if (!message.guild || message.author.bot) return;

    const userId = message.author.id;
    const key = `${message.guild.id}.${userId}`;

    const now = Date.now();
    const last = cooldowns.get(key) || 0;
    if (now - last < XP_COOLDOWN) return;
    cooldowns.set(key, now);

    let data = await db.get(key);
    if (!data) data = { xp: 0, level: 0 };

    data.xp += XP_PER_MESSAGE;

    let leveledUp = false;
    while (data.xp >= getRequiredXP(data.level)) {
        data.xp -= getRequiredXP(data.level);
        data.level++;
        leveledUp = true;
    }

    await db.set(key, data);

    if (leveledUp) {
        message.channel.send(`${message.author} reached **Level ${data.level}**.`);
    }

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

    const buffer = await generateRankCard({
        username: user.username,
        avatarURL: user.displayAvatarURL({ extension: "png", size: 256 }),
        level: userData.level,
        rank,
        currentXP: userData.xp,
        requiredXP: getRequiredXP(userData.level)
    });

    const attachment = new AttachmentBuilder(buffer, { name: "rank.png" });
    await message.channel.send({ files: [attachment] });
}

async function handleLeaderboard(message) {
    const { users } = await getUserDataAndRank(message.guild, message.author.id);

    const top = users.slice(0, 10);
    if (!top.length) return message.channel.send("No one has XP yet.");

    let text = "**Leaderboard**\n\n";
    for (let i = 0; i < top.length; i++) {
        const u = await message.client.users.fetch(top[i].id).catch(() => null);
        const name = u ? u.username : "Unknown";
        text += `**#${i + 1}** - ${name} — Level ${top[i].level} (${top[i].xp} XP)\n`;
    }

    message.channel.send(text);
}

// ===== SLASH COMMANDS =====
const slashCommands = [
    { name: "level", description: "Show your level card" },
    { name: "rank", description: "Show your level card" },
    { name: "leaderboard", description: "Show the server leaderboard" }
];

client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);

    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

    try {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, GUILD_ID),
            { body: slashCommands }
        );
        console.log("Slash commands registered.");
    } catch (err) {
        console.error("Slash command error:", err);
    }
});

// Slash handler
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "level" || interaction.commandName === "rank") {
        const user = interaction.user;
        const { userData, rank } = await getUserDataAndRank(interaction.guild, user.id);

        const buffer = await generateRankCard({
            username: user.username,
            avatarURL: user.displayAvatarURL({ extension: "png", size: 256 }),
            level: userData.level,
            rank,
            currentXP: userData.xp,
            requiredXP: getRequiredXP(userData.level)
        });

        const attachment = new AttachmentBuilder(buffer, { name: "rank.png" });
        await interaction.reply({ files: [attachment] });
    }

    if (interaction.commandName === "leaderboard") {
        const { users } = await getUserDataAndRank(interaction.guild, interaction.user.id);

        const top = users.slice(0, 10);
        if (!top.length) return interaction.reply("No one has XP yet.");

        let text = "**Leaderboard**\n\n";
        for (let i = 0; i < top.length; i++) {
            const u = await interaction.client.users.fetch(top[i].id).catch(() => null);
            const name = u ? u.username : "Unknown";
            text += `**#${i + 1}** - ${name} — Level ${top[i].level} (${top[i].xp} XP)\n`;
        }

        await interaction.reply(text);
    }
});

// LOGIN
client.login(process.env.DISCORD_TOKEN);
