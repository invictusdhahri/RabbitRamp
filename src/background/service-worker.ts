import { getSettings } from "../shared/storage";
import { Message } from "../shared/messages";
import * as logger from "../shared/logger";
import { routeAI } from "./ai/router";
import { testOpenAI } from "./ai/openai";
import { testAnthropic } from "./ai/anthropic";
import { testGemini } from "./ai/gemini";
import {
  initQueueRunner,
  handleQueueSkillStatus,
  messageQueueStart,
  messageGetDegreeArm,
  messageQueueStop,
  getQueueStateForPopup,
} from "./queueRunner";

void initQueueRunner();

chrome.runtime.onMessage.addListener(
  (
    message: Message,
    sender,
    sendResponse: (response?: unknown) => void
  ) => {
    void handleQueueSkillStatus(message, sender);

    switch (message.type) {
      case "QUEUE_START": {
        messageQueueStart(message.payload)
          .then((ok) => sendResponse({ ok }))
          .catch((err: unknown) => {
            logger.error(
              "background",
              "QUEUE_START failed",
              err instanceof Error ? err.message : String(err)
            );
            sendResponse({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case "GET_DEGREE_ARM": {
        messageGetDegreeArm(message.payload.tabId)
          .then(() => sendResponse({ ok: true }))
          .catch((err: unknown) => {
            logger.error(
              "background",
              "GET_DEGREE_ARM failed",
              err instanceof Error ? err.message : String(err)
            );
            sendResponse({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case "QUEUE_GET_STATE": {
        sendResponse(getQueueStateForPopup());
        return false;
      }

      case "QUEUE_STOP": {
        messageQueueStop()
          .then(() => sendResponse({ ok: true }))
          .catch((err: unknown) => {
            logger.error(
              "background",
              "QUEUE_STOP failed",
              err instanceof Error ? err.message : String(err)
            );
            sendResponse({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case "AI_REQUEST": {
        const { prompt, preferredProvider, maxOutputTokens, jsonObjectResponse } =
          message.payload;
        logger.log(
          "background",
          "AI_REQUEST",
          {
            promptChars: prompt.length,
            preferredProvider,
            maxOutputTokens,
            jsonObjectResponse,
            from: sender.tab != null ? "content-script" : "extension-page",
          }
        );
        logger.log("background", "AI_REQUEST full prompt", prompt);
        getSettings()
          .then((settings) =>
            routeAI(prompt, settings, preferredProvider, {
              maxOutputTokens,
              jsonObjectResponse,
            })
          )
          .then(({ text, provider }) => {
            logger.log(
              "background",
              "AI_RESPONSE",
              { provider, responseChars: text.length }
            );
            logger.log("background", "AI_RESPONSE raw body", text);
            sendResponse({ type: "AI_RESPONSE", payload: { text, provider } });
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error("background", "AI_ERROR", msg);
            sendResponse({
              type: "AI_ERROR",
              payload: { error: msg },
            });
          });
        return true;
      }

      case "TEST_PROVIDER": {
        const { provider } = message.payload;
        logger.log("background", "TEST_PROVIDER", { provider });
        getSettings()
          .then(async (settings) => {
            const cfg = settings.providers[provider];
            if (!cfg.apiKey) throw new Error("No API key configured.");
            switch (provider) {
              case "openai":
                await testOpenAI(cfg.apiKey, cfg.model);
                break;
              case "anthropic":
                await testAnthropic(cfg.apiKey, cfg.model);
                break;
              case "gemini":
                await testGemini(cfg.apiKey, cfg.model);
                break;
            }
          })
          .then(() => {
            logger.log("background", "TEST_PROVIDER ok", {
              provider: message.payload.provider,
            });
            sendResponse({
              type: "TEST_PROVIDER_RESULT",
              payload: { provider: message.payload.provider, ok: true },
            });
          })
          .catch((err: unknown) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.warn("background", "TEST_PROVIDER failed", {
              provider: message.payload.provider,
              error: errMsg,
            });
            sendResponse({
              type: "TEST_PROVIDER_RESULT",
              payload: {
                provider: message.payload.provider,
                ok: false,
                error: errMsg,
              },
            });
          });
        return true;
      }

      default:
        return false;
    }
  }
);
