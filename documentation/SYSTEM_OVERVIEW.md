# Packet Builder Browser Extension: System Overview

This document provides a complete overview of the Packet Builder browser extension, detailing its architecture, full workflow, and core logic for development, maintenance, and troubleshooting.

---

## 1. Project Goal

The primary goal of this extension is to automate the process of gathering pricing and market data from PriceLabs and Airbnb. It orchestrates a complex sequence of API calls, UI interactions, and direct web navigation to extract and download several key documents (occupancy adjustments CSV, customizations CSV, market research PDF, and Airbnb price tips CSV) for a given property listing.

---

## 2. Architecture

The extension is composed of two primary scripts that work in tandem:

### `background.ts` (The Orchestrator)
This script acts as the central brain of the extension. It is responsible for:
- **State Management:** Tracking the current status of the workflow (`RUNNING`, `IDLE`, `ERROR`), the current step number, and user-facing messages.
- **Workflow Orchestration:** Executing the entire sequence of operations in the correct order, including handling all wait times between steps.
- **API Communication:** Making all server-to-server calls to the PriceLabs API to get listing data and update base prices.
- **Navigation:** Programmatically navigating the browser to the required URLs for PriceLabs and Airbnb using `chrome.tabs.update()`.
- **Communication Hub:** Sending messages to the content script (`content.ts`) to request UI interactions and receiving responses.

### `content.ts` (The UI Operator)
This script is injected directly into the web pages of PriceLabs and Airbnb. It acts as the hands and eyes of the extension, responsible for:
- **DOM Interaction:** Finding and clicking buttons, reading data from the page, and interacting with web elements.
- **Message Handling:** Listening for commands from `background.ts` (e.g., "click the download button") and executing them on the page.
- **Data Extraction:** Scraping data from the page, such as the Airbnb price tips.
- **Reporting Back:** Sending success or error messages back to the background script after an operation is complete.

---

## 3. Full Workflow Breakdown

The workflow is a linear sequence of steps managed by `background.ts`. The official sequence and timings are maintained in `FULL_WORKFLOW_SEQUENCE.md`.

### Part 1: Initial API Setup
1.  **Get Listing Data (API):** Fetches the current listing details from `GET /v1/listings/{id}`. This is crucial for retrieving the original `base` price and the `max` price. The original base price is stored locally to be restored at the end of the workflow.
2.  **Set Base Price to Max (API):** Sets the listing's `base` price to its `max` price via a `POST /v1/listings` call. This is a necessary step to ensure the subsequent occupancy adjustment download contains the correct data.
3.  **Navigate to PriceLabs:** Navigates the tab to the specific PriceLabs listing URL. A **4-second wait** allows the page to load.

### Part 2: PriceLabs First Sequence (Occupancy & Customizations)
4.  **Click "Sync Now":** Clicks the "Sync Now" button to ensure the UI reflects the API price change.
5.  **Click "Edit":** Enters the listing's edit mode.
6.  **Click "Edit Profile" (Main Page):** Clicks the first "Edit Profile" button to open the "Occupancy Based Adjustments" modal.
7.  **Click "Edit Profile" (Popup):** Clicks the "Edit Profile" button inside the modal to confirm.
8.  **Click "Download" (Popup):** Downloads the Occupancy Adjustments CSV file. A **2-second wait** follows.
9.  **Navigate to Customizations Page:** Directly navigates to `https://app.pricelabs.co/customization`. A **1-second wait** allows the page to load.
10. **Click "Listings" Tab:** Selects the "Listings" tab on the Customizations page. A **1-second wait** follows.
11. **Click "Table View":** Clicks the icon to switch to the table view layout. A **1-second wait** follows.
12. **Click "Download All" CSV:** Downloads the Customizations data as a CSV. A **3-second wait** follows.

### Part 3: Market Research & Airbnb
13. **Navigate to Market Research Page:** Directly navigates to `https://app.pricelabs.co/reports`. A **2-second wait** allows the page to load.
14. **Click "Show Dashboard":** Clicks the button to load the market dashboard.
15. **Wait for Dashboard:** A **10-second wait** is hardcoded to allow the dashboard graphs and data to fully render.
16. **Click "Download as PDF":** Clicks the button to generate and download the market dashboard as a PDF.
17. **Wait for PDF Download:** A **25-second wait** allows the PDF to be generated and the download to begin.
18. **Navigate to Airbnb URL:** Navigates the tab to the paired Airbnb multicalendar URL. A **3-second wait** follows.
19. **Click "Price Tips":** Clicks the "Price Tips" button on the Airbnb calendar.
20. **Zoom Out Browser:** Zooms the browser out to 25% to ensure all price tips are visible on the screen for data extraction.
21. **Extract Price Tips Data:** The content script scrapes the price tip data from the page.
22. **Export Data to CSV:** The extracted price tips are compiled into a CSV and downloaded.
23. **Restore Original Base Price (API):** Makes a `POST /v1/listings` call to restore the original base price that was saved in Step 1.
24. **Restore Browser Zoom:** Restores the browser zoom to its original level.
25. **Navigate Back to PriceLabs:** Navigates the tab back to the original PriceLabs URL. A **3-second wait** follows.

### Part 4: PriceLabs Final Sequence
This sequence of rapid clicks finalizes the process. All steps have a **0-second wait**.
26. **Click "Sync Now"**
27. **Click "Edit"**
28. **Click "Edit Profile" (Main Page)**
29. **Click "Edit Profile" (Popup)**

The workflow is now complete.

---

## 4. Key UI Interaction Strategies

The `content.ts` script uses several robust strategies to find and interact with elements reliably.

### Finding Buttons in Popups ("Edit Profile" & "Download")

When a button is inside a modal (popup), a simple search is unreliable. The extension uses a prioritized, two-step strategy:

1.  **Highest Z-Index Modal Detection:** This is the key. The script assumes the active modal is the one with the highest `z-index` (the one visually on top of everything else).
    *   It finds all potential modal containers on the page using a broad set of selectors (e.g., `[role="dialog"]`, `.chakra-modal__content`).
    *   It filters this list down to only modals that are visible and contain the target button (e.g., a button with "download" in the text).
    *   It selects the single modal from the filtered list that has the highest computed `z-index`.
2.  **Exact Text Match Within Modal:** Once the correct modal is isolated, the script searches *only within that modal* for a button with the **exact text** (e.g., `"Download"` or `"Edit Profile"`). This precision prevents it from clicking similarly named buttons elsewhere on the page.

### Finding the First "Edit Profile" Button (Main Page)

This interaction is simpler as the button is on the main page.
- The script searches for all `<button>` elements.
- It finds the first one that has the exact text `"edit profile"` (case-insensitive) and is currently visible on the page (`offsetParent !== null`).
- It then scrolls the button into the center of the view to ensure it is clickable before dispatching the click event.

---

## 5. Setup & Build Instructions

**Prerequisites:** Node.js must be installed.

1.  **Install Dependencies:**
    ```bash
    npm install
    ```
2.  **Build the Extension:**
    ```bash
    npm run build
    ```
3.  **Load the Extension in Chrome:**
    *   Open Chrome and navigate to `chrome://extensions`.
    *   Enable "Developer mode" in the top right.
    *   Click "Load unpacked".
    *   Select the `dist` folder from the project directory.
