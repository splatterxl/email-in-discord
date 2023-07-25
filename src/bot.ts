import {
	APIInteraction,
	APIMessageComponentInteraction,
	InteractionResponseType,
	InteractionType, RouteBases, Routes
} from 'discord-api-types/v10';
import type { Env } from './worker';
import { Email } from 'postal-mime';

export const handle = async (event: APIInteraction, env: Env) => {
	switch (event.type) {
		case InteractionType.Ping:
			return {
				type: InteractionResponseType.Pong
			};
		case InteractionType.MessageComponent:{
			const interaction = event as APIMessageComponentInteraction;

			switch (interaction.data.custom_id) {
				case 'delete': {
					await request(Routes.channelMessage(interaction.channel_id, interaction.message.id), {
						method: 'DELETE',
					}, env)
					return {
						type: InteractionResponseType.DeferredMessageUpdate
					}
				}
				case 'reply': {
					const embed = interaction.message.embeds?.[1]?.description;

					if (!embed) return {
						type: InteractionResponseType.ChannelMessageWithSource,
						data: {
							content: 'No data embed found'
						}
					}

					const data: Email = JSON.parse(atob(embed));

					await fetch('https://api.mailchannels.net/tx/v1/send', {
						method: 'POST',
						headers: {
							'content-type': 'application/json',
						},
						body: JSON.stringify({
							personalizations: [
								{
									to: [{ email: 'test@example.com', name: 'Test Recipient' }],
								},
							],
							from: {
								email: 'sender@example.com',
								name: 'Workers - MailChannels integration',
							},
							subject: 'Look! No servers',
							content: [
								{
									type: 'text/plain',
									value: 'And no email service accounts and all for free too!',
								},
							],
						}),
					})
				}
			}
		}
		default:
			return {

			}
	}
}

function request(input: string, req: RequestInit, env: Env) {
	return fetch(`${RouteBases.api}${input}`, {
		...req,
		headers: {
			"User-Agent": "DiscordBot (https://github.com/splatterxl/email-in-discord; v1.0.0)",
			Authorization: `Bot ${env.DISCORD_TOKEN}`
		},
	})
}
