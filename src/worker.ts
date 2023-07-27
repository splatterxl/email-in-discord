// noinspection JSUnusedGlobalSymbols

import {
	ButtonStyle,
	ComponentType,
	RESTPostAPIWebhookWithTokenJSONBody,
	RouteBases,
	Routes,
} from "discord-api-types/v10";
import PostalMime from "postal-mime";
import { verify } from "./verify";
import { handle } from "./bot";

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
	GITHUB_TOKEN: string;
}

export default {
	async email(event: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
		const rawEmail = await streamToArrayBuffer(event.raw, event.rawSize);
		const parser = new PostalMime();
		const email = await parser.parse(rawEmail);

		email.attachments = email.attachments.filter(
			(v) => v.filename !== "signature.asc",
		);

		try {
			// still forward in case the request fails: body too long, too many attachments, etc.
			await event.forward(env.FALLBACK_EMAIL);
		} catch {
			console.error("Could not forward to original fallback email address.");
		}

		const formData = new FormData();

		const caseId = crypto.randomUUID();

		const data = btoa(
			JSON.stringify({
				replyTo: email.replyTo ?? [email.from],
				caseId,
				subject: email.subject || "(no subject)",
				inReplyTo: email.inReplyTo,
				messageId: email.messageId,
			}),
		);

		let gist: string | null = null;
		let html: string | null = null;

		if (env.GITHUB_TOKEN) {
			try {
				const res = await fetch(`https://api.github.com/gists`, {
					method: "POST",
					body: JSON.stringify({
						description:
							"📩️ New message to **${event.to}**!%${email.attachments.length > 10 ? ' Extra attachments were forwarded to the fallback email address.' : ''}",
						public: false,
						files: {
							"headers.txt": {
								content: `
							From: ${email.from.name} <${email.from.address}>
							To: ${email.to.map((v) => v.name + " <" + v.address + ">").join(", ")}
							Cc: ${email.cc?.map((v) => v.name + " <" + v.address + ">").join(", ") ?? ""}
							Bcc: ${email.bcc?.map((v) => v.name + " <" + v.address + ">").join(", ") ?? ""}
							Subject: ${email.subject}
							
							Reply-To: ${email.replyTo
									.map((v) => v.name + " <" + v.address + ">")
									.join(", ")}
							${email.headers.map((h) => `${h.name}: ${h.value}`).join("\n")}
						`,
							},
							"readme.html": { content: email.html },
							"readme.txt": { content: email.text },
							...Object.fromEntries(
								email.attachments.map((a) => [
									`attachment-${a.filename}`,
									{ content: a.content },
								]),
							),
						},
					}),
					headers: {
						Authorization: `Bearer ${env.GITHUB_TOKEN}`,
						"X-GitHub-Api-Version": "2022-11-28",
					},
				});

				if (!res.ok) {
					console.error(`Could not upload gist ${res.status}: ${await res.text()}`);
				} else {
					const json = <any>await res.json();
					gist = json.html_url;
					html =
						"https://htmlpreview.github.io/?" +
						json.files["readme.txt"].raw_url;

					console.log(`gist ${gist} html ${html}`)
				}
			} catch (e) {
				console.error("Could not upload to gist: " + e.toString());
			}
		}

		formData.append(
			"payload_json",
			JSON.stringify({
				content: `📩️ New message to **${event.to}**!%${
					email.attachments.length > 10
						? " Extra attachments were forwarded to the fallback email address."
						: ""
				}`,
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
							{
								name: "Message ID",
								value: email.messageId,
							},
							{
								name: "Replying to",
								value: email.inReplyTo ?? "New thread",
							},
						],
						timestamp: email.date && new Date(email.date).toISOString(),
						footer: {
							text: `${email.attachments.length} attachment(s) • ${rawEmail.length} bytes`,
						},
					},
					{ description: data },
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
							...((gist &&
									html && [
										{
											type: ComponentType.Button,
											label: "View full",
											style: ButtonStyle.Link,
											url: gist,
										},
										{
											type: ComponentType.Button,
											label: "View HTML",
											style: ButtonStyle.Link,
											url: html,
										},
									]) ||
								[]),
							{
								type: ComponentType.Button,
								custom_id: "delete",
								label: "Delete",
								style: ButtonStyle.Danger,
							},
						],
					},
				],
				attachments: email.attachments
					.slice(0, 10)
					.map((attachment, index) => ({
						id: index.toString(),
						filename: attachment.filename,
					})),
			} as RESTPostAPIWebhookWithTokenJSONBody),
		);

		for (const [index, attachment] of email.attachments
			.slice(0, 10)
			.entries()) {
			formData.append(
				`files[${index}]`,
				new Blob([attachment.content], { type: attachment.mimeType }),
				attachment.filename,
			);
		}
		const result = await fetch(
			`${RouteBases.api}${Routes.channel(env.CHANNEL_ID)}/messages`,
			{
				method: "POST",
				body: formData,
				headers: {
					"User-Agent":
						"DiscordBot (https://github.com/splatterxl/email-in-discord; v1.0.0)",
					Authorization: `Bot ${env.DISCORD_TOKEN}`,
				},
			},
		);

		if (!result.ok) {
			console.error(await result.text());

			event.setReject("Invalid upstream request. " + result.status);

			throw new Error("Invalid request: " + result.status);
		}
	},
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		if (
			!request.headers.get("X-Signature-Ed25519") ||
			!request.headers.get("X-Signature-Timestamp")
		)
			return Response.redirect(
				"https://github.com/splatterxl/email-in-discord",
			);
		if (!(await verify(request, env.PUBLIC_KEY)))
			return new Response("Unauthorized", { status: 401 });

		return new Response(
			JSON.stringify(await handle(await request.json(), env)),
			{
				status: 200,
				headers: {
					"Content-Type": "application/json",
				},
			},
		);
	},
};
