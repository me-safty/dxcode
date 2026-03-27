import { chromium } from "playwright";
import path from "path";

const BASE_URL = "http://localhost:5733";
const OUT = path.join(__dirname, "screenshots");

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  const page = await context.newPage();

  // Give the app time to hydrate and load data
  console.log("1/8  Loading app...");
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  // --- Screenshot 1: Full sidebar with projects ---
  console.log("2/8  Sidebar overview...");
  await page.screenshot({ path: path.join(OUT, "01-sidebar-overview.png"), fullPage: false });

  // --- Screenshot 2: Jira import dropdown ---
  console.log("3/8  Jira import dropdown...");
  // Find the Jira ticket icon button in the sidebar header area
  const jiraButton = page.locator('button[aria-label*="Jira"], button:has(svg.lucide-ticket)').first();
  if (await jiraButton.isVisible()) {
    await jiraButton.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, "02-jira-import.png"), fullPage: false });
    // Close the popover by pressing Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  } else {
    console.log("   (Jira button not found, skipping)");
  }

  // --- Screenshot 3: Project context menu (right-click) ---
  console.log("4/8  Project context menu...");
  const projectItem = page.locator('[data-sidebar="menu-button"]').first();
  if (await projectItem.isVisible()) {
    await projectItem.click({ button: "right" });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, "03-context-menu.png"), fullPage: false });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  } else {
    console.log("   (No project items found, skipping)");
  }

  // --- Screenshot 4: Command tray buttons ---
  console.log("5/8  Command tray...");
  // Click on the first project to open chat view with command tray
  const firstProject = page.locator('[data-sidebar="menu-button"]').first();
  if (await firstProject.isVisible()) {
    await firstProject.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, "04-command-tray.png"), fullPage: false });
  }

  // --- Screenshot 5: SECDESK and Jira links on a project ---
  console.log("6/8  SECDESK/Jira links...");
  // Expand a project to show the SECDESK/Jira buttons
  const expandButton = page.locator('button:has-text("SECDESK"), button:has-text("Jira")').first();
  if (await expandButton.isVisible()) {
    // Scroll to it and screenshot the area
    await expandButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    // Take a cropped screenshot of the sidebar area
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    if (await sidebar.isVisible()) {
      await sidebar.screenshot({ path: path.join(OUT, "05-secdesk-jira-links.png") });
    }
  } else {
    console.log("   (No SECDESK/Jira links visible, taking sidebar)");
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    if (await sidebar.isVisible()) {
      await sidebar.screenshot({ path: path.join(OUT, "05-secdesk-jira-links.png") });
    }
  }

  // --- Screenshot 6: Standup modal ---
  console.log("7/8  Standup modal...");
  const standupButton = page.locator('button[aria-label*="tandup"], button:has(svg.lucide-message-square-text)').first();
  if (await standupButton.isVisible()) {
    await standupButton.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT, "06-standup-modal.png"), fullPage: false });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  } else {
    console.log("   (Standup button not found, skipping)");
  }

  // --- Screenshot 7: Chat view with agent context ---
  console.log("8/8  Chat view...");
  await page.screenshot({ path: path.join(OUT, "07-chat-view.png"), fullPage: false });

  await browser.close();
  console.log(`\nDone! Screenshots saved to ${OUT}/`);
}

main().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
