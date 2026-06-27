import { describe, expect, it } from "vite-plus/test";

import { sanitizeStudentSlug } from "./slugify.ts";

describe("sanitizeStudentSlug", () => {
  describe("basic names", () => {
    it("converts basic name with space to slug", () => {
      expect(sanitizeStudentSlug("John Smith")).toBe("john-smith");
    });

    it("converts single name to lowercase", () => {
      expect(sanitizeStudentSlug("Alice")).toBe("alice");
    });

    it("converts multi-word names to slug", () => {
      expect(sanitizeStudentSlug("Mary Jane Watson")).toBe("mary-jane-watson");
    });

    it("preserves existing hyphens", () => {
      expect(sanitizeStudentSlug("Jean-Paul")).toBe("jean-paul");
    });
  });

  describe("accented characters", () => {
    it("removes accented characters", () => {
      expect(sanitizeStudentSlug("María García")).toBe("mar-a-garc-a");
    });

    it("removes various diacritics", () => {
      expect(sanitizeStudentSlug("Café Ñoño")).toBe("caf-o-o");
    });

    it("removes umlauts", () => {
      expect(sanitizeStudentSlug("Müller Schön")).toBe("m-ller-sch-n");
    });
  });

  describe("Windows reserved names", () => {
    it("handles CON reserved name", () => {
      expect(sanitizeStudentSlug("CON")).toBe("con-slug");
    });

    it("handles PRN reserved name", () => {
      expect(sanitizeStudentSlug("PRN")).toBe("prn-slug");
    });

    it("handles AUX reserved name", () => {
      expect(sanitizeStudentSlug("AUX")).toBe("aux-slug");
    });

    it("handles NUL reserved name", () => {
      expect(sanitizeStudentSlug("NUL")).toBe("nul-slug");
    });

    it("handles COM1 reserved name", () => {
      expect(sanitizeStudentSlug("COM1")).toBe("com1-slug");
    });

    it("handles COM9 reserved name", () => {
      expect(sanitizeStudentSlug("COM9")).toBe("com9-slug");
    });

    it("handles LPT1 reserved name", () => {
      expect(sanitizeStudentSlug("LPT1")).toBe("lpt1-slug");
    });

    it("handles LPT9 reserved name", () => {
      expect(sanitizeStudentSlug("LPT9")).toBe("lpt9-slug");
    });

    it("handles reserved name with different casing", () => {
      expect(sanitizeStudentSlug("con")).toBe("con-slug");
      expect(sanitizeStudentSlug("Con")).toBe("con-slug");
      expect(sanitizeStudentSlug("CoN")).toBe("con-slug");
    });

    it("does not modify non-reserved names that contain reserved names", () => {
      expect(sanitizeStudentSlug("Conrad")).toBe("conrad");
      expect(sanitizeStudentSlug("Print")).toBe("print");
    });
  });

  describe("empty strings", () => {
    it("returns empty string for empty input", () => {
      expect(sanitizeStudentSlug("")).toBe("");
    });

    it("returns empty string for whitespace-only input", () => {
      expect(sanitizeStudentSlug("   ")).toBe("");
    });

    it("returns empty string for special-characters-only input", () => {
      expect(sanitizeStudentSlug("!!!")).toBe("");
    });

    it("returns empty string for null-like inputs", () => {
      // @ts-expect-error - testing runtime behavior
      expect(sanitizeStudentSlug(null)).toBe("");
      // @ts-expect-error - testing runtime behavior
      expect(sanitizeStudentSlug(undefined)).toBe("");
    });
  });

  describe("very long names", () => {
    it("truncates names longer than 64 characters", () => {
      const longName = "a".repeat(100);
      const result = sanitizeStudentSlug(longName);
      expect(result.length).toBe(64);
      expect(result).toBe("a".repeat(64));
    });

    it("truncates with words and removes trailing hyphen", () => {
      const longName = "abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyz-morestuff";
      const result = sanitizeStudentSlug(longName);
      expect(result.length).toBeLessThanOrEqual(64);
      expect(result.endsWith("-")).toBe(false);
    });

    it("handles exactly 64 characters", () => {
      const exactName = "a".repeat(64);
      expect(sanitizeStudentSlug(exactName)).toBe(exactName);
    });

    it("handles 63 characters (under limit)", () => {
      const underLimit = "a".repeat(63);
      expect(sanitizeStudentSlug(underLimit)).toBe(underLimit);
    });
  });

  describe("special characters", () => {
    it("removes apostrophes", () => {
      expect(sanitizeStudentSlug("O'Brien")).toBe("o-brien");
    });

    it("removes punctuation", () => {
      expect(sanitizeStudentSlug("John, Jr.")).toBe("john-jr");
    });

    it("removes symbols", () => {
      expect(sanitizeStudentSlug("User@#$%Name")).toBe("user-name");
    });

    it("removes parentheses", () => {
      expect(sanitizeStudentSlug("John (Jack) Smith")).toBe("john-jack-smith");
    });

    it("removes underscores and replaces with hyphens", () => {
      expect(sanitizeStudentSlug("john_smith")).toBe("john-smith");
    });
  });

  describe("leading/trailing hyphens", () => {
    it("removes leading hyphens", () => {
      expect(sanitizeStudentSlug("-john")).toBe("john");
    });

    it("removes trailing hyphens", () => {
      expect(sanitizeStudentSlug("john-")).toBe("john");
    });

    it("removes both leading and trailing hyphens", () => {
      expect(sanitizeStudentSlug("-john-")).toBe("john");
    });

    it("removes multiple leading hyphens", () => {
      expect(sanitizeStudentSlug("---john")).toBe("john");
    });

    it("removes multiple trailing hyphens", () => {
      expect(sanitizeStudentSlug("john---")).toBe("john");
    });

    it("removes leading/trailing hyphens created by special chars", () => {
      expect(sanitizeStudentSlug("!John!")).toBe("john");
    });
  });

  describe("consecutive hyphens", () => {
    it("collapses multiple hyphens to single hyphen", () => {
      expect(sanitizeStudentSlug("john--smith")).toBe("john-smith");
    });

    it("collapses many consecutive hyphens", () => {
      expect(sanitizeStudentSlug("john-----smith")).toBe("john-smith");
    });

    it("collapses hyphens created by multiple special characters", () => {
      expect(sanitizeStudentSlug("john!!!smith")).toBe("john-smith");
    });

    it("handles multiple sets of consecutive hyphens", () => {
      expect(sanitizeStudentSlug("a--b--c")).toBe("a-b-c");
    });
  });

  describe("case collision prevention", () => {
    it("converts uppercase to lowercase", () => {
      expect(sanitizeStudentSlug("JOHN")).toBe("john");
    });

    it("converts mixed case to lowercase", () => {
      expect(sanitizeStudentSlug("JoHn SmItH")).toBe("john-smith");
    });

    it("prevents case collision", () => {
      const slug1 = sanitizeStudentSlug("John");
      const slug2 = sanitizeStudentSlug("john");
      const slug3 = sanitizeStudentSlug("JOHN");
      expect(slug1).toBe(slug2);
      expect(slug2).toBe(slug3);
    });
  });

  describe("complex edge cases", () => {
    it("handles name with multiple issues", () => {
      expect(sanitizeStudentSlug("  -John O'Brien III-  ")).toBe("john-o-brien-iii");
    });

    it("handles name with accents and special chars", () => {
      expect(sanitizeStudentSlug("María José García-López")).toBe("mar-a-jos-garc-a-l-pez");
    });

    it("handles numbers", () => {
      expect(sanitizeStudentSlug("Student123")).toBe("student123");
      expect(sanitizeStudentSlug("Class 2024")).toBe("class-2024");
    });

    it("preserves valid slug", () => {
      expect(sanitizeStudentSlug("john-smith-123")).toBe("john-smith-123");
    });

    it("handles emoji and unicode", () => {
      expect(sanitizeStudentSlug("John 😊 Smith")).toBe("john-smith");
    });

    it("handles Chinese characters", () => {
      expect(sanitizeStudentSlug("王小明")).toBe("");
    });

    it("handles mixed alphanumeric", () => {
      expect(sanitizeStudentSlug("abc123def456")).toBe("abc123def456");
    });
  });
});
