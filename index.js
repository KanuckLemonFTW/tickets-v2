import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import fs from 'fs';

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
function saveData() { fs.writeFileSync('./data.json', JSON.stringify(data, null, 2)); }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const commands = [
  new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('Configure ticket bot settings')
    .addSubcommand(sc => sc.setName('log-channel').setDescription('Set ticket log channel').addChannelOption(o => o.setName('channel').setDescription('Log channel').setRequired(true)))
    .addSubcommand(sc => sc.setName('panel').setDescription('Send verification panel'))
    .addSubcommand(sc => sc.setName('category').setDescription('Set ticket category/support role for a ticket type')
      .addStringOption(o=>o.setName('type').setDescription('Ticket type').setRequired(true))
      .addChannelOption(o=>o.setName('category').setDescription('Discord category').setRequired(true))
      .addRoleOption(o=>o.setName('support').setDescription('Support role').setRequired(true))
    ),
  new SlashCommandBuilder()
    .setName('create-ticket')
    .setDescription('Create a ticket')
    .addStringOption(o=>o.setName('type').setDescription('Ticket type').setRequired(true))
].map(c=>c.toJSON());

await new REST({ version: '10' }).setToken(TOKEN).put(Routes.applicationCommands(CLIENT_ID), { body: commands });
console.log('Commands registered');

client.once('ready', ()=>console.log(`Logged in as ${client.user.tag}`));
