require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  AttachmentBuilder,
  REST,
  Routes
} = require("discord.js");

const { QuickDB } = require("quick.db");
const db = new QuickDB();

const { createCanvas, loadImage } = require("canvas");

// ===== BOT SETUP =====
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
const GUILD_ID = "YOUR_GUILD_ID_HERE";

const cooldowns = new Map();

// XP formula
function getRequiredXP(level) {
  return 5 * (level ** 2) + 50 * level + 100;
}

// ===== UI CARD FUNCTION (SHOP-BOT STYLE, RED THEME) =====
async function generateLevelCard(member, level, rank, currentXP, requiredXP) {
  const canvas = createCanvas(1000, 350);
  const ctx = canvas.getContext("2d");

  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#2A0004");
  gradient.addColorStop(1, "#5A000A");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Avatar
  const avatar = await loadImage(
    member.user.displayAvatarURL({ extension: "png", size: 256 })
  );

  // Glow ring
  ctx.save();
  ctx.shadowColor = "rgba(255, 0, 60, 0.35)";
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(150, canvas.height / 2, 110, 0, Math.PI * 2);
  ctx.fillStyle = "#2A0004";
  ctx.fill();
  ctx.restore();

  // Avatar circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(150, canvas.height / 2, 100, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(avatar, 50, canvas.height / 2 - 100, 200, 200);
  ctx.restore();

  // Text settings
  ctx.fillStyle = "#FFFFFF";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  // Username
  ctx.font = "bold 48px sans-serif";
  ctx.fillText(member.displayName, 300, 90);

  // Level + Rank
  ctx.font = "28px sans-serif";
  ctx.fillText(`LEVEL ${level}   •   RANK #${rank}`, 300, 140);

  // XP text
  ctx.font = "24px sans-serif";
  ctx.fillText(`${currentXP} / ${requiredXP} XP`, 300, 180);

  // XP bar
  const barX = 300;
  const barY = 230;
  const barWidth = 650;
  const barHeight = 35;

  // Background bar
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  roundRect(ctx, barX, barY, barWidth, barHeight, 15);
  ctx.fill();

  // Fill bar
  const xpPercent = Math.min(currentXP / requiredXP, 1);
  const fillWidth = barWidth * xpPercent;

  ctx.fillStyle = "#FF003C";
  roundRect(ctx, barX, barY, fillWidth, barHeight, 15);
  ctx.fill();

  // Glow on XP bar
  ctx.save();
  ctx.shadowColor = "rgba(255, 0, 60, 0.45)";
  ctx.shadowBlur = 20;
  ctx.fillStyle = "#FF003C";
  roundRect(ctx, barX, barY, fillWidth, barHeight, 15);
  ctx.fill();
  ctx.restore();

  return canvas.toBuffer();
}

// Rounded rectangle helper
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

  const buffer = await generateLevelCard(
    message.member,
    userData.level,
    rank,
    userData.xp,
    getRequiredXP(userData.level)
  );

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

    const buffer = await generateLevelCard(
      interaction.member,
      userData.level,
      rank,
      userData.xp,
      getRequiredXP(userData.level)
    );

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