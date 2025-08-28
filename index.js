import 'dotenv/config';
import express from 'express';
import { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const API_KEY = process.env.API_KEY;
const PORT = process.env.PORT || 3000;

const CODES = new Map(); // code -> { rpName, createdAt, expiresAt }

const client = new Client({ intents: [GatewayIntentBits.Guilds], partials: [Partials.Channel] });

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('nickme')
      .setDescription('Imposta il tuo nickname Discord al Nome RP del gioco')
      .addStringOption(o => o.setName('codice').setDescription('Codice a 6 cifre').setRequired(true)),
    // opzionale: comando staff per rinominare altri
    new SlashCommandBuilder()
      .setName('nickrp')
      .setDescription('Imposta il nickname di un membro a un Nome RP')
      .addUserOption(o => o.setName('membro').setDescription('Membro da rinominare').setRequired(true))
      .addStringOption(o => o.setName('nome_rp').setDescription('Es. Emanuele Rossi').setRequired(true))
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('Slash commands registrati');
}

client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;

  // /nickme <codice>
  if (i.commandName === 'nickme') {
    const code = i.options.getString('codice');
    const entry = CODES.get(code);
    if (!entry || Date.now() > entry.expiresAt) {
      return i.reply({ content: 'Codice non valido o scaduto.', ephemeral: true });
    }

    const rpName = entry.rpName;
    CODES.delete(code);

    try {
      await i.member.setNickname(rpName);
      await i.reply({ content: `Fatto! Il tuo nickname ora è: ${rpName}`, ephemeral: true });
    } catch (err) {
      console.error(err);
      await i.reply({
        content: 'Non posso rinominarti (manca il permesso, il mio ruolo è troppo in basso, oppure sei owner).',
        ephemeral: true
      });
    }
  }

  // /nickrp @membro "Nome Cognome" (per staff)
  if (i.commandName === 'nickrp') {
    const member = i.options.getMember('membro');
    const rpName = i.options.getString('nome_rp');

    // opzionale: limita ai ruoli staff
    // if (!i.member.roles.cache.has('ROLE_ID_STAFF')) { ... }

    try {
      await member.setNickname(rpName);
      await i.reply({ content: `Nickname aggiornato: ${member.user.username} → ${rpName}`, ephemeral: true });
    } catch (err) {
      console.error(err);
      await i.reply({ content: 'Non posso rinominare quel membro (permessi/gerarchia).', ephemeral: true });
    }
  }
});

// Server HTTP per ricevere codici dal gioco
const app = express();
app.use(express.json());

app.post('/nick-codes', (req, res) => {
  const key = req.header('x-api-key');
  if (key !== API_KEY) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const { code, rpName } = req.body || {};
  if (!code || !rpName) return res.status(400).json({ ok: false, error: 'missing fields' });

  const TTL = 10 * 60 * 1000; // 10 minuti
  CODES.set(code, { rpName, createdAt: Date.now(), expiresAt: Date.now() + TTL });
  return res.json({ ok: true });
});

app.listen(PORT, () => console.log('HTTP API on', PORT));
client.login(TOKEN).then(registerCommands).catch(console.error);
