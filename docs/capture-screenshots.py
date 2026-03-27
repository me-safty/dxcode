#!/usr/bin/env python3
"""Capture screenshots of Fly Code features using Playwright."""

import os
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:5733"
OUT = os.path.join(os.path.dirname(__file__), "screenshots")
os.makedirs(OUT, exist_ok=True)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            color_scheme="dark",
        )
        page = context.new_page()

        # Load app
        print("1/8  Loading app...")
        page.goto(BASE_URL, wait_until="networkidle")
        page.wait_for_timeout(3000)

        # 1: Full sidebar overview
        print("2/8  Sidebar overview...")
        page.screenshot(path=os.path.join(OUT, "01-sidebar-overview.png"))

        # 2: Jira import dropdown
        print("3/8  Jira import dropdown...")
        jira_btn = page.locator("button:has(svg.lucide-ticket)").first
        if jira_btn.is_visible():
            jira_btn.click()
            page.wait_for_timeout(2000)
            page.screenshot(path=os.path.join(OUT, "02-jira-import.png"))
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)
        else:
            print("   (Jira button not found, trying alt selector)")
            # Try clicking by aria or text
            alt = page.locator('[aria-label="Import from Jira"]').first
            if alt.is_visible():
                alt.click()
                page.wait_for_timeout(2000)
                page.screenshot(path=os.path.join(OUT, "02-jira-import.png"))
                page.keyboard.press("Escape")
                page.wait_for_timeout(500)

        # 3: Project context menu
        print("4/8  Project context menu...")
        project = page.locator('[data-sidebar="menu-button"]').first
        if project.is_visible():
            project.click(button="right")
            page.wait_for_timeout(800)
            page.screenshot(path=os.path.join(OUT, "03-context-menu.png"))
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)

        # 4: Click into a project to see chat + command tray
        print("5/8  Command tray...")
        # Click the first thread/project to open chat
        thread_link = page.locator('[data-sidebar="menu-sub-button"]').first
        if thread_link.is_visible():
            thread_link.click()
            page.wait_for_timeout(2000)
            page.screenshot(path=os.path.join(OUT, "04-chat-command-tray.png"))

        # 5: SECDESK and Jira links in sidebar
        print("6/8  SECDESK/Jira links...")
        sidebar = page.locator('[data-sidebar="sidebar"]').first
        if sidebar.is_visible():
            sidebar.screenshot(path=os.path.join(OUT, "05-sidebar-links.png"))

        # 6: Standup modal
        print("7/8  Standup modal...")
        standup_btn = page.locator("button:has(svg.lucide-message-square-text)").first
        if standup_btn.is_visible():
            standup_btn.click()
            page.wait_for_timeout(1000)
            page.screenshot(path=os.path.join(OUT, "06-standup-modal.png"))
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)
        else:
            # Try by text
            alt = page.locator('button:has-text("Standup")').first
            if alt.is_visible():
                alt.click()
                page.wait_for_timeout(1000)
                page.screenshot(path=os.path.join(OUT, "06-standup-modal.png"))
                page.keyboard.press("Escape")
                page.wait_for_timeout(500)
            else:
                print("   (Standup button not found)")

        # 7: summary.md view
        print("8/8  Summary view...")
        summary_btn = page.locator('button:has-text("summary.md")').first
        if summary_btn.is_visible():
            summary_btn.click()
            page.wait_for_timeout(1000)
            page.screenshot(path=os.path.join(OUT, "07-summary-view.png"))
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)

        # Final full-page shot
        page.screenshot(path=os.path.join(OUT, "08-full-app.png"))

        browser.close()
        print(f"\nDone! Screenshots saved to {OUT}/")


if __name__ == "__main__":
    main()
