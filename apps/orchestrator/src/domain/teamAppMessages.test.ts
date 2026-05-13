import { describe, expect, it } from "vitest";

import {
  applyTeamAppMuteCommand,
  isAsideTeamAppMessage,
  mentionsNonTeamAppSlackUser,
  mentionsTeamAppUser,
  shouldIgnoreTeamAppMessage,
  teamAppMuteCommandReaction,
} from "./teamAppMessages.ts";

describe("team app message domain helpers", () => {
  describe("isAsideTeamAppMessage", () => {
    it.each(["aside - this is for humans", " aside - ignore this", "ASIDE - not for ai"])(
      "detects aside prefix in %s",
      (body) => {
        expect(isAsideTeamAppMessage(body)).toBe(true);
      },
    );

    it.each(["aside but no dash", "- aside old prefix", "we should set aside time"])(
      "does not treat %s as an aside",
      (body) => {
        expect(isAsideTeamAppMessage(body)).toBe(false);
      },
    );
  });

  describe("shouldIgnoreTeamAppMessage", () => {
    it("hard-ignores aside messages even when the AI Engineer is mentioned", () => {
      expect(
        shouldIgnoreTeamAppMessage({
          body: "aside - @Vevin we should discuss privately",
          isThreadMuted: false,
          mentionsAiEngineer: true,
        }),
      ).toEqual({ ignore: true, reason: "aside" });
    });

    it("ignores ambient messages in muted Team App threads", () => {
      expect(
        shouldIgnoreTeamAppMessage({
          body: "I think we should revisit the UX copy",
          isThreadMuted: true,
        }),
      ).toEqual({ ignore: true, reason: "muted" });
    });

    it("allows mentions in muted Team App threads", () => {
      expect(
        shouldIgnoreTeamAppMessage({
          body: "@Engineering can you answer this?",
          isThreadMuted: true,
          mentionsAiEngineer: true,
        }),
      ).toEqual({ ignore: false });
    });

    it("allows unmute requests in muted Team App threads without requiring a mention", () => {
      expect(
        shouldIgnoreTeamAppMessage({
          body: "unmute please",
          isThreadMuted: true,
        }),
      ).toEqual({ ignore: false });
    });

    it("allows ordinary messages in unmuted Team App threads", () => {
      expect(
        shouldIgnoreTeamAppMessage({
          body: "Please keep going",
          isThreadMuted: false,
        }),
      ).toEqual({ ignore: false });
    });
  });

  describe("applyTeamAppMuteCommand", () => {
    it("mutes a Team App thread when requested", () => {
      expect(
        applyTeamAppMuteCommand({
          body: "@Vevin mute this thread",
          isThreadMuted: false,
          mentionsAiEngineer: true,
        }),
      ).toEqual({ muted: true, changed: true, command: "mute" });
    });

    it("unmutes a Team App thread when requested", () => {
      expect(
        applyTeamAppMuteCommand({
          body: "@Vevin unmute, you can respond again",
          isThreadMuted: true,
          mentionsAiEngineer: true,
        }),
      ).toEqual({ muted: false, changed: true, command: "unmute" });
    });

    it("is idempotent for repeated mute and unmute requests", () => {
      expect(
        applyTeamAppMuteCommand({
          body: "@Vevin mute please",
          isThreadMuted: true,
          mentionsAiEngineer: true,
        }),
      ).toEqual({ muted: true, changed: false, command: "mute" });

      expect(
        applyTeamAppMuteCommand({
          body: "@Vevin unmute please",
          isThreadMuted: false,
          mentionsAiEngineer: true,
        }),
      ).toEqual({ muted: false, changed: false, command: "unmute" });
    });

    it("leaves mute state unchanged when there is no command", () => {
      expect(
        applyTeamAppMuteCommand({
          body: "Can you check the failing typecheck?",
          isThreadMuted: false,
          mentionsAiEngineer: false,
        }),
      ).toEqual({ muted: false, changed: false });
    });

    it("ignores mute command words unless the bot is mentioned", () => {
      expect(
        applyTeamAppMuteCommand({
          body: "mute this topic for now",
          isThreadMuted: false,
          mentionsAiEngineer: false,
        }),
      ).toEqual({ muted: false, changed: false });
    });
  });

  describe("teamAppMuteCommandReaction", () => {
    it("maps mute commands to acknowledgement reactions", () => {
      expect(teamAppMuteCommandReaction("mute")).toBe("zipper_mouth_face");
      expect(teamAppMuteCommandReaction("unmute")).toBe("speaker");
    });
  });

  describe("mentionsTeamAppUser", () => {
    it("detects Slack user-id mentions and Vevin name mentions", () => {
      expect(mentionsTeamAppUser({ body: "<@U123> mute", botUserId: "U123" })).toBe(true);
      expect(mentionsTeamAppUser({ body: "@U123 mute", botUserId: "U123" })).toBe(true);
      expect(mentionsTeamAppUser({ body: "@Vevin unmute" })).toBe(true);
    });

    it("detects configured bot names", () => {
      expect(mentionsTeamAppUser({ body: "@Engineering mute", botUserName: "Engineering" })).toBe(
        true,
      );
    });

    it("does not match ordinary text", () => {
      expect(mentionsTeamAppUser({ body: "please keep going", botUserName: "Engineering" })).toBe(
        false,
      );
    });
  });

  describe("mentionsNonTeamAppSlackUser", () => {
    it("detects Slack mentions for other users", () => {
      expect(
        mentionsNonTeamAppSlackUser({
          body: "<@U0791S1K34N|John Ta> devin is cooked",
          botUserId: "U0B0T56AY7R",
        }),
      ).toBe(true);
    });

    it("detects Chat SDK normalized display-name mentions for other users", () => {
      expect(
        mentionsNonTeamAppSlackUser({
          body: "@John Ta devin is cooked",
          botUserId: "U0B0T56AY7R",
        }),
      ).toBe(true);
    });

    it("ignores the bot's own Slack mention", () => {
      expect(
        mentionsNonTeamAppSlackUser({
          body: "<@U0B0T56AY7R|Vevin> mute",
          botUserId: "U0B0T56AY7R",
        }),
      ).toBe(false);
    });
  });
});
