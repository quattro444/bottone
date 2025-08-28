import 'dotenv/config';
import express from 'express';
import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder
} from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID; // Application ID
const GUILD_ID  = process.env.GUILD_ID;  // ID del server dove registrare i comandi
const API_KEY   = process.env.API_KEY;   // Uguale a quella che metti in Roblox
const PORT      = process.env.PORT || 3000;

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !API_KEY) {
  console.error('Mancano variabili nel .env (DISCORD_TOKEN, CLIENT_ID, GUILD_ID, API_KEY).');
  process.exit(1);
}

const CODES = new Map(); // code -> { rpName, createdAt, expiresAt }

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel]
});

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('nickme')
      .setDescription('Imposta il tuo nickname al Nome RP del gioco')
      .addStringOption(o =>
        o.setName('codice').setDescription('Codice a 6 cifre ricevuto in gioco').setRequired(true)
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

  const rpName = entry.rpName;
  CODES.delete(code);

  try {
    await interaction.member.setNickname(rpName);
    await interaction.reply({ content: `Fatto! Il tuo nickname ora è: ${rpName}`, ephemeral: true });
  } catch (err) {
    console.error('Errore setNickname:', err);
    await interaction.reply({
      content: 'Non posso rinominarti (permessi mancanti, ruolo del bot troppo in basso, oppure sei owner).',
      ephemeral: true
    });
  }
});

// Mini API per ricevere codice dal gioco
const app = express();
app.use(express.json());

app.post('/nick-codes', (req, res) => {
  const key = req.header('x-api-key');
  if (key !== API_KEY) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const { code, rpName } = req.body || {};
  if (!code || !rpName) return res.status(400).json({ ok: false, error: 'missing fields' });

  const TTL = 10 * 60 * 1000; // 10min
  CODES.set(code, { rpName, createdAt: Date.now(), expiresAt: Date.now() + TTL });

  return res.json({ ok: true });
});

app.get('/', (_req, res) => res.send('NickBot online')); // ping

app.listen(PORT, () => console.log('HTTP API on', PORT));
client.login(TOKEN).then(registerCommands).catch(console.error);
