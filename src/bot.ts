import {
	APIInteraction,
	APIInteractionResponse,
	APIMessageComponentInteraction,
	ComponentType,
	InteractionResponseType,
	InteractionType,
	MessageFlags,
	RouteBases,
	Routes,
	TextInputStyle
} from 'discord-api-types/v10';
import type {Env} from './worker';

export const handle = async (event: APIInteraction, env: Env): Promise<APIInteractionResponse> => {
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
					}, env);

					return {
						type: InteractionResponseType.DeferredMessageUpdate
					}
				}
				case 'reply': {
					const embed = interaction.message.embeds?.[1]?.description;

					if (!embed) return {
						type: InteractionResponseType.ChannelMessageWithSource,
						data: {
							content: 'No data embed found',
							flags: MessageFlags.Ephemeral
						}
					}

					const data: {subject: string} = JSON.parse(atob(embed));

					return {
						type: InteractionResponseType.Modal,
						data: {
							title: `Re: ${data.subject.replace(/^(Re: )+/g, '').slice(0, 1024)}`,
							custom_id: 'reply',
							components: [
								{
									type: ComponentType.ActionRow,
									components: [
										{
											type: ComponentType.TextInput,
											custom_id: 'subject',
											required: true,
											placeholder: 'Subject line in email',
											label: "Subject",
											value: `Re: ${data.subject.replace(/^(Re: )+/g, '')}`,
											style: TextInputStyle.Short,
											min_length: 1,
											max_length: 1024
										}
									]
								},
								{
									type: ComponentType.ActionRow,
									components: [
										{
											type: ComponentType.TextInput,
											custom_id: 'body',
											required: true,
											label: "Body",
											style: TextInputStyle.Paragraph,
											min_length: 1,
											max_length: 2000
										}
									]
								}
							]
						}
					}
				}
				default: {
					return {
						type: InteractionResponseType.ChannelMessageWithSource,
						data: {
							content: 'Unsupported custom id',
							flags: MessageFlags.Ephemeral
						}
					}
				}
			}
		}
		default:
			return {
				type: InteractionResponseType.ChannelMessageWithSource,
				data: { content:"Unsupported interaction type", flags: MessageFlags.Ephemeral }
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
