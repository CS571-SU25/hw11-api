import { Express } from 'express';

import { pipeline, Readable, Transform } from 'stream';
import { CS571Route } from "@cs571/api-framework/src/interfaces/route";
import { CS571HW11DbConnector } from '../services/hw11-db-connector';
import HW11SecretConfig from '../model/configs/hw11-secret-config';
import OpenAIMessageLog from '../model/openai-message-log';
import OpenAIMessage from '../model/openai-message';
import OpenAIMessageRole from '../model/openai-message-role';
import HW11PublicConfig from '../model/configs/hw11-public-config';

export class CS571AICompletionsStreamRoute implements CS571Route {

    public static readonly ROUTE_NAME: string = (process.env['CS571_BASE_PATH'] ?? "") + '/completions-stream';

    private readonly connector: CS571HW11DbConnector;
    private readonly publicConfig: HW11PublicConfig;
    private readonly secretConfig: HW11SecretConfig;

    public constructor(connector: CS571HW11DbConnector, publicConfig: HW11PublicConfig, secretConfig: HW11SecretConfig) {
        this.connector = connector;
        this.publicConfig = publicConfig;
        this.secretConfig = secretConfig;
    }

    public addRoute(app: Express): void {
        app.post(CS571AICompletionsStreamRoute.ROUTE_NAME, async (req, res) => {
            let isShort = req.query?.shortContext ? req.query.shortContext === "true" : false;
            let messages;
            try {
                messages = CS571AICompletionsStreamRoute.validateMessages(req.body);
            } catch (e) {
                res.status(400).send({
                    msg: "The request body does not contain a valid list of chat objects."
                });
                return;
            }

            const len = messages.reduce((acc: number, msg: OpenAIMessage) => acc + msg.content.length, 0);
            if (isShort ? len > (this.publicConfig.MAX_INPUT_LENGTH / 4) : len > this.publicConfig.MAX_INPUT_LENGTH) {
                res.status(413).send({
                    msg: "The request body is too long for the given context window."
                });
                return;
            }

            try {
                const toLog = new OpenAIMessageLog(messages, req.header('X-CS571-ID') as string);
                await this.connector.log(toLog);

                const resp = await fetch(this.secretConfig.AI_COMPLETIONS_URL, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${this.secretConfig.AI_COMPLETIONS_SECRET}`
                    },
                    body: JSON.stringify({
                        messages: messages.reduce((acc: OpenAIMessage[], msg: OpenAIMessage) => [...acc, { role: msg.role, content: msg.content }], []),
                        max_completion_tokens: this.secretConfig.AI_COMPLETIONS_MAX_RESPONSE,
                        stream: true
                    })
                });
                if (resp.body) {
                    const nodeStream = Readable.fromWeb(resp.body as any);
                    let dataline = "";
                    const simplifyData = new Transform({
                        transform(chunk, encoding, callback) {
                            dataline += chunk.toString();

                            let respObj = { delta: "" };
                            let lines = dataline.split("\n");
                            dataline = lines.pop() || "";
                            
                            for (const line of lines) {
                                const trimmed = line.trim();
                                if (!trimmed) continue;

                                let data = trimmed.startsWith("data: ") ? trimmed.substring(6).trim() : trimmed;

                                if (data === "[DONE]") {
                                    continue;
                                }

                                try {
                                    let parsedContent = JSON.parse(data)?.choices?.[0]?.delta?.content;
                                    if (parsedContent) {
                                        respObj.delta += parsedContent;
                                    }
                                } catch (err) {
                                    dataline += data;
                                }
                            }

                            callback(null, JSON.stringify(respObj) + "\n");
                        },
                        flush(callback) {
                            if (dataline.trim()) {
                                try {
                                    let parsedContent = JSON.parse(dataline)?.choices?.[0]?.delta?.content;
                                    if (parsedContent) {
                                        const respObj = { delta: parsedContent };
                                        this.push(JSON.stringify(respObj) + "\n");
                                    }
                                } catch (err) {
                                    // Ignore malformed leftover.
                                }
                            }
                            callback();
                        }
                    });
                    pipeline(
                        nodeStream,
                        simplifyData,
                        res,
                        (err: any) => {
                            if (err) {
                                console.error('Pipeline failed:', err);
                                res.status(500).send({
                                    msg: "An unknown server error occured during exection. Try again in a few minutes."
                                });
                            }
                        }
                    );
                } else {
                    res.end();
                }
            } catch (e) {
                res.status(500).send({
                    msg: "An unknown server error occured during exection. Try again in a few minutes."
                })
            }
        })
    }

    private static validateMessages(messages: any): OpenAIMessage[] {
        if (!Array.isArray(messages)) {
            throw new Error("The request body does not contain a valid list of chat objects.");
        }

        if (!messages.every((msg: any) => Object.keys(msg).includes("role") && Object.keys(msg).includes("content"))) {
            throw new Error("The request body does not contain a valid list of chat objects.");
        }

        if (!messages.every((msg: any) => {
            let keys = Object.keys(msg);
            return keys.includes("role") && keys.includes("content") && Object.values(OpenAIMessageRole).includes(msg.role);
        })) {
            throw new Error("The request body does not contain a valid list of chat objects.");
        }

        return messages as OpenAIMessage[];
    }

    public getRouteName(): string {
        return CS571AICompletionsStreamRoute.ROUTE_NAME;
    }
}
