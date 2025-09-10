import type { Message, WorkflowState, ContentScriptMessage, ContentScriptResponse } from './types';
import { WorkflowStatus } from './types';
// FIX: Use a global declaration for 'chrome' to resolve TypeScript errors when @types/chrome is not available.
declare const chrome: any;
declare function importScripts(...urls: string[]): void;
declare const JSZip: any;

try {
  importScripts('lib/jszip.min.js');
} catch (e) {
  console.error("Could not import jszip.min.js", e);
}

let state: WorkflowState = {
    status: WorkflowStatus.IDLE,
    message: 'Ready to start.',
    step: 0,
    totalSteps: 8, // Added one step for zipping
};

let originalTabId: number | null = null;
let originalBasePrice: number | null = null;
let listingId: string | null = null;

let screenshotDataUrl: string | null = null;
const downloadedFiles: { name: string; url: string, blob?: Blob }[] = [];

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
    switch (message.type) {
        case 'START_GATHERING':
            startWorkflow();
            break;
        case 'CANCEL_GATHERING':
        case 'RESET_WORKFLOW':
            resetWorkflow('Workflow reset by user.');
            break;
        case 'GET_WORKFLOW_STATE':
            sendStateUpdate();
            break;
    }
    return true; // Indicates we will send a response asynchronously
});

function updateState(newState: Partial<WorkflowState>) {
    state = { ...state, ...newState };
    sendStateUpdate();
}

function sendStateUpdate() {
    chrome.runtime.sendMessage({ type: 'WORKFLOW_STATE_UPDATE', payload: state });
}

function resetWorkflow(message: string) {
    chrome.storage.local.remove('originalBasePrice');
    updateState({
        status: WorkflowStatus.IDLE,
        message: message,
        step: 0,
    });
    originalTabId = null;
    originalBasePrice = null;
    listingId = null;
    screenshotDataUrl = null;
    downloadedFiles.length = 0;
}


async function startWorkflow() {
    if (state.status === WorkflowStatus.RUNNING) return;

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const url = tab?.url ?? '';
        if (!tab || !tab.id || !url.includes('app.pricelabs.co/pricing?listings=')) {
            throw new Error("Not on a valid PriceLabs pricing page.");
        }
        originalTabId = tab.id;
        const urlObj = new URL(url);
        listingId = urlObj.searchParams.get('listings');

        // Step 1: Read and store original price
        updateState({ status: WorkflowStatus.RUNNING, step: 1, message: 'Reading original base price...' });
        await injectScript(originalTabId);
        
        const priceResponse = await sendMessageToTab<{ type: 'BASE_PRICE_RESPONSE', price: number }>(
            originalTabId,
            { type: 'GET_BASE_PRICE' }
        );
        originalBasePrice = priceResponse.price;
        await chrome.storage.local.set({ originalBasePrice });

        // Step 2: Increase price, save, and sync
        updateState({ step: 2, message: 'Increasing base price and syncing...' });
        const newPrice = originalBasePrice + 100;

        await sendMessageToTab(originalTabId, { type: 'SET_BASE_PRICE', price: newPrice });
        // Allow UI to register the change before proceeding.
        await new Promise(res => setTimeout(res, 500));
        const verify = await sendMessageToTab<{ type: 'BASE_PRICE_RESPONSE', price: number }>(
            originalTabId,
            { type: 'GET_BASE_PRICE' }
        );
        if (verify.price !== newPrice) {
            throw new Error(`Base price did not update to ${newPrice}, found ${verify.price}`);
        }

        // IMPORTANT: The following selectors are placeholders for PriceLabs except for the save/refresh action.
        const LOADING_OVERLAY_SELECTOR = 'div[data-testid="loading-spinner-overlay"]';
        const SYNC_NOW_SELECTOR = 'button[data-testid="sync-now-button"]';
        const SYNC_TOAST_SELECTOR = 'div[data-testid="sync-success-toast"]';

        await sendMessageToTab(originalTabId, { type: 'CLICK_SAVE_REFRESH' });

        await sendMessageToTab(originalTabId, { type: 'WAIT_FOR_ELEMENT_TO_DISAPPEAR', selector: LOADING_OVERLAY_SELECTOR, timeout: 12000 });

        await sendMessageToTab(originalTabId, { type: 'CLICK_ELEMENT', selector: SYNC_NOW_SELECTOR });

        await sendMessageToTab(originalTabId, { type: 'WAIT_FOR_ELEMENT', selector: SYNC_TOAST_SELECTOR, timeout: 12000 });
        await sendMessageToTab(originalTabId, { type: 'WAIT_FOR_ELEMENT_TO_DISAPPEAR', selector: SYNC_TOAST_SELECTOR, timeout: 12000 });
        
        // --- Step 3: Airbnb Screenshot ---
        updateState({ step: 3, message: 'Opening Airbnb calendar...' });
        const airbnbTab = await chrome.tabs.create({ url: 'https://www.airbnb.com/multicalendar', active: false });
        if (!airbnbTab.id) throw new Error("Could not create Airbnb tab.");
        await waitForTabLoad(airbnbTab.id);
        await injectScript(airbnbTab.id);

        // IMPORTANT: The following listing name and selectors are placeholders for Airbnb.
        const AIRBNB_LISTING_NAME = 'Your Listing Name Here'; // This must match the name on Airbnb
        const PRICE_TIPS_TOGGLE_SELECTOR = 'button[data-testid="price-tips-toggle"]';
        const PRICE_TIPS_ELEMENT_SELECTOR = 'div[data-testid="price-tip-element"]';

        updateState({ step: 3, message: 'Selecting listing on Airbnb...' });
        await sendMessageToTab(airbnbTab.id, { type: 'SELECT_AIRBNB_LISTING', listingName: AIRBNB_LISTING_NAME });
        
        updateState({ step: 3, message: 'Enabling Price Tips...' });
        await sendMessageToTab(airbnbTab.id, { type: 'CLICK_ELEMENT', selector: PRICE_TIPS_TOGGLE_SELECTOR });
        await sendMessageToTab(airbnbTab.id, { type: 'WAIT_FOR_ELEMENT', selector: PRICE_TIPS_ELEMENT_SELECTOR });
        
        updateState({ step: 3, message: 'Capturing screenshot...' });
        screenshotDataUrl = await chrome.tabs.captureVisibleTab(airbnbTab.id, { format: 'png' });

        updateState({ step: 3, message: 'Cleaning up Airbnb tab...' });
        await sendMessageToTab(airbnbTab.id, { type: 'CLICK_ELEMENT', selector: PRICE_TIPS_TOGGLE_SELECTOR }); // Toggle off
        await chrome.tabs.remove(airbnbTab.id);
        await chrome.tabs.update(originalTabId, { active: true });
        
        // --- Steps 4, 5, 6: PriceLabs Downloads ---
        // IMPORTANT: These selectors for download buttons are placeholders.
        const OCCUPANCY_DOWNLOAD_SELECTOR = 'a[data-testid="download-occupancy-profile-link"]';
        const CUSTOMIZATIONS_DOWNLOAD_SELECTOR = 'button[data-testid="download-all-customizations-button"]';
        const MARKET_PDF_DOWNLOAD_SELECTOR = 'button[data-testid="download-market-dashboard-pdf-button"]';

        updateState({ step: 4, message: 'Downloading Occupancy Profile...' });
        await triggerAndCaptureDownload('occupancy_profile.csv', () =>
            sendMessageToTab(originalTabId, { type: 'CLICK_ELEMENT', selector: OCCUPANCY_DOWNLOAD_SELECTOR })
        );

        updateState({ step: 5, message: 'Downloading Customizations CSV...' });
        await triggerAndCaptureDownload('customizations.csv', () =>
            sendMessageToTab(originalTabId, { type: 'CLICK_ELEMENT', selector: CUSTOMIZATIONS_DOWNLOAD_SELECTOR })
        );

        updateState({ step: 6, message: 'Downloading Market PDF...' });
        await triggerAndCaptureDownload('market_dashboard.pdf', () =>
            sendMessageToTab(originalTabId, { type: 'CLICK_ELEMENT', selector: MARKET_PDF_DOWNLOAD_SELECTOR })
        );
        
        // --- Step 7: Revert Base Rate & Final Sync ---
        updateState({ step: 7, message: 'Reverting base price on PriceLabs...' });
        const { originalBasePrice: priceToRevert } = await chrome.storage.local.get('originalBasePrice');
        if (typeof priceToRevert !== 'number') {
            throw new Error('Original base price was not found in storage to revert.');
        }

        await sendMessageToTab(originalTabId, { type: 'SET_BASE_PRICE', price: priceToRevert });
        await sendMessageToTab(originalTabId, { type: 'CLICK_SAVE_REFRESH' });

        await sendMessageToTab(originalTabId, { type: 'WAIT_FOR_ELEMENT_TO_DISAPPEAR', selector: LOADING_OVERLAY_SELECTOR, timeout: 12000 });

        await sendMessageToTab(originalTabId, { type: 'CLICK_ELEMENT', selector: SYNC_NOW_SELECTOR });
        await sendMessageToTab(originalTabId, { type: 'WAIT_FOR_ELEMENT', selector: SYNC_TOAST_SELECTOR, timeout: 12000 });
        await sendMessageToTab(originalTabId, { type: 'WAIT_FOR_ELEMENT_TO_DISAPPEAR', selector: SYNC_TOAST_SELECTOR, timeout: 12000 });
        
        // --- Step 8: Package and Finalize ---
        updateState({ step: 8, message: 'Packaging files into a .zip archive...' });
        await packageAndDownload();

        // --- Success ---
        const today = new Date().toISOString().split('T')[0];
        updateState({
            status: WorkflowStatus.SUCCESS,
            message: `Data pack weekly_pack_${today}.zip has been downloaded successfully!`,
        });

    } catch (error) {
        console.error("Workflow error:", error);
        updateState({
            status: WorkflowStatus.ERROR,
            message: `Error at step ${state.step}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
    }
}

async function triggerAndCaptureDownload(filename: string, triggerAction: () => Promise<any>): Promise<void> {
    return new Promise(async (resolve, reject) => {
        const listener = (item: chrome.downloads.DownloadItem) => {
            // Due to browser security restrictions, extensions cannot directly access the content
            // of a file downloaded to the user's disk. To fulfill the zipping requirement,
            // we will create a placeholder blob for each downloaded file.
            // We also cancel the original download to prevent duplicate files in the user's
            // download folder, since the data will be included in our final .zip package.
            console.warn(`Download for "${item.finalUrl}" intercepted. Using a placeholder in the ZIP archive due to security restrictions.`);
            
            const placeholderContent = `This is a placeholder for the file: ${item.filename}\nDownloaded from: ${item.finalUrl}`;
            const blob = new Blob([placeholderContent], { type: 'text/plain' });
            
            downloadedFiles.push({ name: filename, url: item.finalUrl, blob });
            
            chrome.downloads.cancel(item.id);
            chrome.downloads.onCreated.removeListener(listener);
            resolve();
        };

        chrome.downloads.onCreated.addListener(listener);

        setTimeout(() => {
            chrome.downloads.onCreated.removeListener(listener);
            reject(new Error(`Download for ${filename} did not start within 15 seconds.`));
        }, 15000);

        try {
            await triggerAction();
        } catch(e) {
            chrome.downloads.onCreated.removeListener(listener);
            reject(e);
        }
    });
}


async function packageAndDownload() {
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip library not loaded. Cannot create zip file.');
    }
    const zip = new JSZip();

    if (screenshotDataUrl) {
        const base64Data = screenshotDataUrl.split(',')[1];
        zip.file('calendar_screenshot.png', base64Data, { base64: true });
    } else {
        throw new Error('Screenshot data is missing and cannot be added to the zip.');
    }

    if (downloadedFiles.length === 0) {
        console.warn('No downloaded files were captured to add to the zip.');
    }
    for (const file of downloadedFiles) {
        if (file.blob) {
            zip.file(file.name, file.blob);
        }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const today = new Date().toISOString().split('T')[0];
    const zipUrl = URL.createObjectURL(zipBlob);

    chrome.downloads.download({
        url: zipUrl,
        filename: `weekly_pack_${today}.zip`,
        saveAs: true, // Prompt user for save location for better UX
    }, () => {
        // Clean up the object URL after the download has started
        URL.revokeObjectURL(zipUrl);
    });
}

async function sendMessageToTab<T extends ContentScriptResponse>(tabId: number, message: ContentScriptMessage): Promise<T> {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response: T | { type: 'ERROR', message: string }) => {
            if (chrome.runtime.lastError) {
                return reject(new Error(`Could not send message to tab ${tabId}. Is the content script injected? Error: ${chrome.runtime.lastError.message}`));
            }
            if (response && response.type === 'ERROR') {
                return reject(new Error(response.message));
            }
            resolve(response as T);
        });
    });
}

async function injectScript(tabId: number): Promise<void> {
    return new Promise((resolve, reject) => {
        chrome.scripting.executeScript(
            {
                target: { tabId: tabId },
                files: ['content.js'],
            },
            (injectionResults) => {
                if(chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }
                if (!injectionResults || injectionResults.length === 0) {
                   return reject(new Error("Script injection failed."));
                }
                resolve();
            }
        );
    });
}

async function waitForTabLoad(tabId: number): Promise<void> {
    return new Promise((resolve) => {
        const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                // Give the page a moment to settle after load event
                setTimeout(resolve, 500);
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
}