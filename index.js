import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import fs from 'fs';

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

let data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
function saveData() { fs.writeFileSync('./data.json', JSON.stringify(data, null, 2)); }

if (!data.openTickets) data.openTickets = {};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// ===== Commands =====
const commands = [
  new SlashCommandBuilder()
    .setName('create-ticket')
    .setDescription('Create a ticket')
    .addStringOption(o =>
      o.setName('type')
       .setDescription('Select ticket type')
       .setRequired(true)
       .addChoices(
         { name: 'Verify', value: 'verify' },
         { name: 'General Support', value: 'general_support' },
         { name: 'Staff Report', value: 'staff_report' },
         { name: 'Management Report', value: 'management_report' },
         { name: 'Management Support', value: 'management_support' },
         { name: 'Appeal Ticket', value: 'appeal_ticket' }
       )
    ),
  new SlashCommandBuilder()
    .setName('ticket-move')
    .setDescription('Move the ticket to another category')
    .addStringOption(o =>
      o.setName('category')
       .setDescription('Select new category')
       .setRequired(true)
       .addChoices(
         { name: 'Verify', value: 'verify' },
         { name: 'General Support', value: 'general_support' },
         { name: 'Staff Report', value: 'staff_report' },
         { name: 'Management Report', value: 'management_report' },
         { name: 'Management Support', value: 'management_support' },
         { name: 'Appeal Ticket', value: 'appeal_ticket' }
       )
    ),
  new SlashCommandBuilder()
    .setName('ticket-add')
    .setDescription('Add a user to the ticket')
    .addUserOption(o => o.setName('user').setDescription('User to add').setRequired(true)),
  new SlashCommandBuilder()
    .setName('ticket-remove')
    .setDescription('Remove a user from the ticket')
    .addUserOption(o => o.setName('user').setDescription('User to remove').setRequired(true))
].map(c => c.toJSON());

// ===== Register Commands =====
const rest = new REST({ version: '10' }).setToken(TOKEN);
await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
console.log('Commands registered');

// ===== Ready =====
client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));

// ===== Interaction =====
client.on('interactionCreate', async i => {
  if (!i.isChatInputCommand() && !i.isButton()) return;

  // ---------- Slash Commands ----------
  if (i.isChatInputCommand()) {
    const type = i.options.getString('type');
    const ticketType = data.ticketTypes[type];

    // ---------- /create-ticket ----------
    if (i.commandName === 'create-ticket') {
      if (!ticketType) return i.reply({ content: '❌ Invalid ticket type.', ephemeral: true });

      const guild = i.guild;
      const everyone = guild.roles.everyone;

      const ticketChannel = await guild.channels.create({
        name: `ticket-${i.user.username.toLowerCase()}`,
        type: 0,
        parent: ticketType.categoryId,
        permissionOverwrites: [
          { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          ...ticketType.supportRoles.map(r => ({ id: r, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
        ]
      });

      data.openTickets[ticketChannel.id] = type;
      saveData();

      const embed = new EmbedBuilder()
        .setTitle(`Ticket: ${type}`)
        .setDescription(`Ticket created by ${i.user.tag}`)
        .setColor(0x00AAFF);

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger)
        );

      await ticketChannel.send({ content: `<@${i.user.id}>`, embeds: [embed], components: [row] });

      if (data.ticketLogChannel) {
        const log = client.channels.cache.get(data.ticketLogChannel);
        if (log?.isTextBased()) log.send({ content: `📩 Ticket ${ticketChannel.name} created by ${i.user.tag}` });
      }

      return i.reply({ content: `✅ Your ticket has been created: ${ticketChannel}`, ephemeral: true });
    }

    // ---------- /ticket-move ----------
    if (i.commandName === 'ticket-move') {
      const newType = i.options.getString('category');
      const newTicketType = data.ticketTypes[newType];
      if (!newTicketType) return i.reply({ content: '❌ Invalid category.', ephemeral: true });

      const channel = i.channel;
      const currentType = data.openTickets[channel.id];
      if (!currentType) return i.reply({ content: '❌ Not a ticket channel.', ephemeral: true });

      const member = await i.guild.members.fetch(i.user.id);
      if (!member.roles.cache.some(r => data.ticketTypes[currentType].supportRoles.includes(r.id))) return i.reply({ content: '❌ You are not allowed to move this ticket.', ephemeral: true });

      await channel.setParent(newTicketType.categoryId);
      data.openTickets[channel.id] = newType;
      saveData();
      return i.reply({ content: `✅ Ticket moved to ${newType}.`, ephemeral: true });
    }

    // ---------- /ticket-add ----------
    if (i.commandName === 'ticket-add') {
      const user = i.options.getUser('user');
      const channel = i.channel;
      const type = data.openTickets[channel.id];
      if (!type) return i.reply({ content: '❌ Not a ticket channel.', ephemeral: true });

      const member = await i.guild.members.fetch(i.user.id);
      if (!member.roles.cache.some(r => data.ticketTypes[type].supportRoles.includes(r.id))) return i.reply({ content: '❌ You are not allowed to add users.', ephemeral: true });

      await channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
      return i.reply({ content: `✅ Added ${user.tag} to the ticket.`, ephemeral: true });
    }

    // ---------- /ticket-remove ----------
    if (i.commandName === 'ticket-remove') {
      const user = i.options.getUser('user');
      const channel = i.channel;
      const type = data.openTickets[channel.id];
      if (!type) return i.reply({ content: '❌ Not a ticket channel.', ephemeral: true });

      const member = await i.guild.members.fetch(i.user.id);
      if (!member.roles.cache.some(r => data.ticketTypes[type].supportRoles.includes(r.id))) return i.reply({ content: '❌ You are not allowed to remove users.', ephemeral: true });

      await channel.permissionOverwrites.delete(user.id);
      return i.reply({ content: `✅ Removed ${user.tag} from the ticket.`, ephemeral: true });
    }
  }

  // ---------- Button Handlers ----------
  if (i.isButton()) {
    const channel = i.channel;
    const type = data.openTickets[channel.id];
    if (!type) return i.reply({ content: '❌ Ticket type not recognized.', ephemeral: true });

    const ticketType = data.ticketTypes[type];
    const supportRoles = ticketType.supportRoles;
    const member = await i.guild.members.fetch(i.user.id);

    // Claim
    if (i.customId === 'claim_ticket') {
      if (!member.roles.cache.some(r => supportRoles.includes(r.id))) return i.reply({ content: '❌ You are not authorized to claim this ticket.', ephemeral: true });
      return i.reply({ content: `✅ Ticket claimed by ${i.user.tag}`, ephemeral: true });
    }

    // Close
    if (i.customId === 'close_ticket') {
      if (!member.roles.cache.some(r => supportRoles.includes(r.id))) return i.reply({ content: '❌ You are not authorized to close this ticket.', ephemeral: true });

      if (data.transcriptChannel) {
        let messages = await channel.messages.fetch({ limit: 100 });
        messages = messages.map(m => `[${m.author.tag}] ${m.content}`).reverse().join('\n');
        const transcriptChannel = client.channels.cache.get(data.transcriptChannel);
        if (transcriptChannel?.isTextBased()) {
          await transcriptChannel.send({
            content: `📄 Transcript for ${channel.name}`,
            files: [{ attachment: Buffer.from(messages, 'utf-8'), name: `${channel.name}-transcript.txt` }]
          });
        }
      }

      if (data.ticketLogChannel) {
        const log = client.channels.cache.get(data.ticketLogChannel);
        if (log?.isTextBased()) log.send({ content: `❌ Ticket ${channel.name} closed by ${i.user.tag}` });
      }

      delete data.openTickets[channel.id];
      saveData();

      await i.reply({ content: '✅ Ticket closed and channel will be deleted shortly.', ephemeral: true });
      setTimeout(() => channel.delete().catch(() => {}), 3000);
    }

    // Verification panel
    if (i.customId === 'verify_ticket') {
      const vt = data.ticketTypes['verify'];
      const everyone = i.guild.roles.everyone;

      const ticketChannel = await i.guild.channels.create({
        name: `ticket-${i.user.username.toLowerCase()}`,
        type: 0,
        parent: vt.categoryId,
        permissionOverwrites: [
          { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          ...vt.supportRoles.map(r => ({ id: r, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
        ]
      });

      data.openTickets[ticketChannel.id] = 'verify';
      saveData();

      const embed = new EmbedBuilder()
        .setTitle('Verification Ticket')
        .setDescription(`Ticket created by ${i.user.tag}`)
        .setColor(0x00FF00);

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger)
        );

      await ticketChannel.send({ content: `<@${i.user.id}>`, embeds: [embed], components: [row] });

      if (data.ticketLogChannel) {
        const log = client.channels.cache.get(data.ticketLogChannel);
        if (log?.isTextBased()) log.send({ content: `📩 Verification ticket ${ticketChannel.name} created by ${i.user.tag}` });
      }

      return i.reply({ content: `✅ Verification ticket created: ${ticketChannel}`, ephemeral: true });
    }
  }
});

// ===== Login =====
client.login(TOKEN);
