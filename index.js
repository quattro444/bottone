import 'dotenv/config';
import express from 'express';
import {
  Client, GatewayIntentBits, Partials,
  REST, Routes, SlashCommandBuilder
} from 'discord.js';

const TOKEN   = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;   // Application ID
const GUILD_ID  = process.env.GUILD_ID;    // Server ID
const API_KEY   = process.env.API_KEY;     // usata anche su Roblox
const PORT      = process.env.PORT || 3000;
const ADMIN_ROLE_IDS = (process.env.ADMIN_ROLE_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !API_KEY) {
  console.error('Mancano variabili: DISCORD_TOKEN, CLIENT_ID, GUILD_ID, API_KEY');
  process.exit(1);
}

const CODES = new Map(); // code -> { rpName, createdAt, expiresAt }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers], // NECESSARIO
  partials: [Partials.Channel]
});

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('nickme')
      .setDescription('Imposta il tuo nickname al Nome RP del gioco')
      .addStringOption(o =>
        o.setName('codice').setDescription('Codice a 6 cifre dal gioco').setRequired(true)
      )
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('Slash commands registrati su guild:', GUILD_ID);
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'nickme') return;

  const code = interaction.options.getString('codice');
  const entry = CODES.get(code);

  if (!entry || Date.now() > entry.expiresAt) {
    return interaction.reply({ content: 'Codice non valido o scaduto.', ephemeral: true });
  }

  CODES.delete(code);
  try {
    await interaction.member.setNickname(entry.rpName);
    await interaction.reply({ content: `Fatto! Nickname impostato a: ${entry.rpName}`, ephemeral: true });
  } catch (err) {
    console.error('setNickname error:', err);
    await interaction.reply({
      content: 'Non posso rinominarti (permessi/gerarchia/owner).',
      ephemeral: true
    });
  }
});

// ---------- Express ----------
const app = express();
app.use(express.json());

// sanity check
app.get('/', (_req, res) => res.send('NickBot online'));

// riceve codici dal gioco
app.post('/nick-codes', (req, res) => {
  const key = req.header('x-api-key');
  if (key !== API_KEY) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const { code, rpName } = req.body || {};
  if (!code || !rpName) return res.status(400).json({ ok: false, error: 'missing fields' });

  const TTL = 10 * 60 * 1000; // 10 min
  CODES.set(code, { rpName, createdAt: Date.now(), expiresAt: Date.now() + TTL });
  return res.json({ ok: true });
});

// verifica admin con nickname = Nome RP + ruolo
app.get('/is-admin', async (req, res) => {
  const key = req.header('x-api-key');
  if (key !== API_KEY) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const rp = (req.query.rp || req.query.rpName || '').trim();
  if (!rp) return res.status(400).json({ ok: false, error: 'missing rp' });

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    // richiede GuildMembers intent
    const candidates = await guild.members.search({ query: rp, limit: 10 });
    let found = candidates.find(m => m.displayName === rp)
            || candidates.find(m => m.displayName.toLowerCase() === rp.toLowerCase());
    let isAdmin = false;
    if (found) {
      isAdmin = ADMIN_ROLE_IDS.length > 0
        ? ADMIN_ROLE_IDS.some(rid => found.roles.cache.has(rid))
        : found.permissions.has('Administrator');
    }
    return res.json({ ok: true, isAdmin, matched: !!found });
  } catch (err) {
    console.error('is-admin error:', err);
    return res.status(500).json({ ok: false, error: 'internal error' });
  }
});

// AVVIO: UN SOLO app.listen QUI
app.listen(PORT, () => {
  console.log('HTTP API on', PORT);
});

// login bot e registrazione comandi
client.login(TOKEN).then(registerCommands).catch(console.error);
