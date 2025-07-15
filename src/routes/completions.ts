import { Express } from 'express';

import { CS571Route } from "@cs571/api-framework/src/interfaces/route";
import { CS571HW11DbConnector } from '../services/hw11-db-connector';
import HW11SecretConfig from '../model/configs/hw11-secret-config';
import OpenAIMessageLog from '../model/openai-message-log';
import OpenAIMessage from '../model/openai-message';
import OpenAIMessageRole from '../model/openai-message-role';
import HW11PublicConfig from '../model/configs/hw11-public-config';

export class CS571AICompletionsRoute implements CS571Route {

    public static readonly ROUTE_NAME: string = (process.env['CS571_BASE_PATH'] ?? "") + '/completions';

    private readonly connector: CS571HW11DbConnector;
    private readonly publicConfig: HW11PublicConfig;
    private readonly secretConfig: HW11SecretConfig;

    public constructor(connector: CS571HW11DbConnector, publicConfig: HW11PublicConfig, secretConfig: HW11SecretConfig) {
        this.connector = connector;
        this.publicConfig = publicConfig;
        this.secretConfig = secretConfig;
    }

    public addRoute(app: Express): void {
        app.post(CS571AICompletionsRoute.ROUTE_NAME, async (req, res) => {
            let isShort = req.query?.shortContext ? Boolean(req.query.shortContext) : false;
            let messages;
            try {
                messages = CS571AICompletionsRoute.validateMessages(req.body);
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
                        max_completion_tokens: this.secretConfig.AI_COMPLETIONS_MAX_RESPONSE
                    })
                })
                const data = await resp.json();
                res.status(200).send({
                    msg: data.choices[0].message.content
                });
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
        return CS571AICompletionsRoute.ROUTE_NAME;
    }
}
