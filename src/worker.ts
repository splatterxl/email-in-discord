import {
	ButtonStyle,
	ComponentType,
	RESTPostAPIWebhookWithTokenJSONBody,
	RouteBases,
	Routes
} from 'discord-api-types/v10';
import PostalMime from 'postal-mime';
import { verify } from './verify';
import { handle } from './bot';

async function streamToArrayBuffer(stream: ReadableStream, streamSize: number) {
	let result = new Uint8Array(streamSize);
	let bytesRead = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		result.set(value, bytesRead);
		bytesRead += value.length;
	}
	return result;
}

export interface Env {
	FALLBACK_EMAIL: string;
	CHANNEL_ID: string;
	DISCORD_TOKEN: string;
	PUBLIC_KEY: string;
}

export default {
	async email(event: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
		const rawEmail = await streamToArrayBuffer(event.raw, event.rawSize);
		const parser = new PostalMime();
		const email = await parser.parse(rawEmail);

		email.attachments = email.attachments.filter(v => v.filename !== 'signature.asc');

		if (email.attachments.length > 10) event.forward(env.FALLBACK_EMAIL);

		const formData = new FormData();

		const caseId = crypto.randomUUID();

		const data = btoa(JSON.stringify({
			replyTo: email.replyTo ?? [email.from],
			caseId,
			body: email.text
		}));

		formData.append(
			"payload_json",
			JSON.stringify({
				content: `📩️ New message to **${event.to}**!`,
				embeds: [
					{
						title: email.subject,
						description: email.text,
						color: 0x00ff00,
						author: {
							name: `${email.from.name} <${email.from.address}>`,
						},
						fields: [
							...[
								{
									inline: true,
									name: "Cc",
									value:
										email.cc
											?.map((cc) => `${cc.name} (${cc.address})`)
											.join(", ") || "None",
								},
								{
									inline: true,
									name: "Bcc",
									value:
										email.bcc
											?.map((bcc) => `${bcc.name} (${bcc.address})`)
											.join(", ") || "None",
								},
								{
									inline: true,
									name: "Reply To",
									value:
										email.replyTo
											?.map((replyTo) => `${replyTo.name} (${replyTo.address})`)
											.join(", ") || "None",
								},
							].filter((v) => v.value !== "None"),
							...email.headers
								.filter(
									(v) =>
										v.name?.toLowerCase &&
										!["from", "to", "cc", "bcc", "reply-to"].includes(
											v.name.toLowerCase(),
										),
								)
								.map((header) => ({
									inline: true,
									name: header.name.replace(/-/g, " "),
									value: header.value,
								})),
						],
						timestamp: email.date && new Date(email.date).toISOString(),
						footer: {
							text: `${email.attachments.length} attachment(s) • ${
								rawEmail.length
							} bytes ${
								email.inReplyTo ? "• reply to " + email.inReplyTo : ""
							}`,
						},
					},
					{description: data }
				],
				components: [
					{
						type: ComponentType.ActionRow,
						components: [
							{
								type: ComponentType.Button,
								custom_id: "reply",
								label: "Reply",
								style: ButtonStyle.Primary,
							},
							{
								type: ComponentType.Button,
								custom_id: "forward",
								label: "Forward",
								style: ButtonStyle.Secondary,
							},
							{
								type: ComponentType.Button,
								custom_id: "delete",
								label: "Delete",
								style: ButtonStyle.Danger,
							}
						],
					}
				],
				attachments: email.attachments
					.slice(0, 10)
					.map((attachment, index) => ({
						id: index.toString(),
						filename: attachment.filename,
					})),
			} as RESTPostAPIWebhookWithTokenJSONBody),
		);

		for (const [index, attachment] of email.attachments.slice(0, 10).entries()) {
			formData.append(
				`files[${index}]`,
				new Blob(
					[attachment.content],
					{ type: attachment.mimeType }
				),
				attachment.filename
			);
		}
		const result = await fetch(`${RouteBases.api}${Routes.channel(env.CHANNEL_ID)}/messages`, {
			method: "POST",
			body: formData,
			headers: {
				"User-Agent": "DiscordBot (https://github.com/splatterxl/email-in-discord; v1.0.0)",
				Authorization: `Bot ${env.DISCORD_TOKEN}`
			},
		});

		if (!result.ok) {
			console.error(await result.text());

			throw new Error("Invalid request: " + result.status);
		}
	},
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		if (!request.headers.get('X-Signature-Ed25519') || !request.headers.get('X-Signature-Timestamp')) return Response.redirect('https://github.com/splatterxl/email-in-discord')
		if (!await verify(request, env.PUBLIC_KEY)) return new Response('Unauthorized', { status: 401 })

		return new Response(JSON.stringify(handle(await request.json(), env)))
	}
};
