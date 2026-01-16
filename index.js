import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import fs from 'fs';

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

let data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
function saveData() { fs.writeFileSync('./data.json', JSON.stringify(data, null, 2)); }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// ====== Commands ======
const commands = [
  new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('Configure ticket bot settings')
    .addSubcommand(sc => sc.setName('log-channel').setDescription('Set ticket log channel')
      .addChannelOption(o => o.setName('channel').setDescription('Log channel').setRequired(true)))
    .addSubcommand(sc => sc.setName('panel').setDescription('Send verification panel'))
    .addSubcommand(sc => sc.setName('category').setDescription('Set ticket category/support role for a ticket type')
      .addStringOption(o => o.setName('type').setDescription('Ticket type').setRequired(true))
      .addChannelOption(o => o.setName('category').setDescription('Discord category').setRequired(true))
      .addRoleOption(o => o.setName('support').setDescription('Support role').setRequired(true)))
    .addSubcommand(sc => sc.setName('transcripts').setDescription('Set transcript channel').addChannelOption(o => o.setName('channel').setDescription('Transcript channel').setRequired(true))),
  
  new SlashCommandBuilder()
    .setName('create-ticket')
    .setDescription('Create a ticket')
    .addStringOption(o => o.setName('type').setDescription('Ticket type').setRequired(true))
].map(c => c.toJSON());

// ====== Register Commands ======
const rest = new REST({ version: '10' }).setToken(TOKEN);
await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
console.log('Commands registered');

// ====== Event: Ready ======
client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));

// ====== Event: Interaction Create ======
client.on('interactionCreate', async i => {
  if (!i.isChatInputCommand() && !i.isButton()) return;

  // ----------------- Slash Commands -----------------
  if (i.isChatInputCommand()) {
    // ---------- /ticket-setup ----------
    if (i.commandName === 'ticket-setup') {
      if (i.options.getSubcommand() === 'log-channel') {
        const channel = i.options.getChannel('channel');
        data.ticketLogChannel = channel.id;
        saveData();
        return i.reply({ content: `✅ Ticket log channel set to ${channel.name}`, ephemeral: true });
      }

      if (i.options.getSubcommand() === 'panel') {
        const panelChannel = client.channels.cache.get(data.verificationPanelChannel);
        if (!panelChannel?.isTextBased()) return i.reply({ content: '❌ Verification panel channel not found.', ephemeral: true });

        const panelEmbed = new EmbedBuilder()
          .setTitle('Click to Verify')
          .setDescription('Click the button below to create a verification ticket.')
          .setColor(0x00FF00);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('verify_ticket').setLabel('Verify').setStyle(ButtonStyle.Primary)
        );

        await panelChannel.send({ embeds: [panelEmbed], components: [row] });
        return i.reply({ content: '✅ Verification panel sent.', ephemeral: true });
      }

      if (i.options.getSubcommand() === 'category') {
        const type = i.options.getString('type');
        const category = i.options.getChannel('category');
        const support = i.options.getRole('support');

        if (!data.ticketTypes[type]) data.ticketTypes[type] = {};
        data.ticketTypes[type].categoryId = category.id;
        data.ticketTypes[type].supportRoles = [support.id];
        saveData();
        return i.reply({ content: `✅ Updated ticket type ${type}`, ephemeral: true });
      }

      if (i.options.getSubcommand() === 'transcripts') {
        if (i.user.id !== i.guild.ownerId) return i.reply({ content: '❌ Only server owner can set transcripts.', ephemeral: true });
        const channel = i.options.getChannel('channel');
        data.transcriptChannel = channel.id;
        saveData();
        return i.reply({ content: `✅ Transcript channel set to ${channel.name}`, ephemeral: true });
      }
    }

    // ---------- /create-ticket ----------
    if (i.commandName === 'create-ticket') {
      const type = i.options.getString('type');
      const ticketType = data.ticketTypes[type];
      if (!ticketType) return i.reply({ content: '❌ Invalid ticket type.', ephemeral: true });

      const guild = i.guild;
      const everyone = guild.roles.everyone;

      // Create ticket channel
      const ticketChannel = await guild.channels.create({
        name: `ticket-${i.user.username.toLowerCase()}`,
        type: 0, // GUILD_TEXT
        parent: ticketType.categoryId,
        permissionOverwrites: [
          { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          ...ticketType.supportRoles.map(r => ({ id: r, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
        ]
      });

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
  }

  // ----------------- Button Interaction -----------------
  if (i.isButton()) {
    const channel = i.channel;
    const ticketType = Object.values(data.ticketTypes).find(t => t.categoryId === channel.parentId);
    if (!ticketType) return i.reply({ content: '❌ Ticket type not recognized.', ephemeral: true });

    const supportRoles = ticketType.supportRoles;
    const member = await i.guild.members.fetch(i.user.id);

    if (i.customId === 'verify_ticket') {
      // Verification ticket
      const type = 'verify';
      const vt = data.ticketTypes[type];
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

    // ---------- Claim ----------
    if (i.customId === 'claim_ticket') {
      if (!member.roles.cache.some(r => supportRoles.includes(r.id))) return i.reply({ content: '❌ You are not authorized to claim this ticket.', ephemeral: true });
      await i.reply({ content: `✅ Ticket claimed by ${i.user.tag}` });
    }

    // ---------- Close ----------
    if (i.customId === 'close_ticket') {
      if (!member.roles.cache.some(r => supportRoles.includes(r.id))) return i.reply({ content: '❌ You are not authorized to close this ticket.', ephemeral: true });

      // Fetch messages for transcript
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

      await i.reply({ content: '✅ Ticket closed and channel will be deleted shortly.', ephemeral: true });
      setTimeout(() => channel.delete().catch(() => {}), 3000);
    }
  }
});

// ====== LOGIN ======
client.login(TOKEN);
