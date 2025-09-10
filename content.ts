import type { ContentScriptMessage, ContentScriptResponse } from './types';

// FIX: Use a global declaration for 'chrome' to resolve TypeScript errors when @types/chrome is not available.
declare const chrome: any;

// This script is injected into the target pages to interact with the DOM.

const waitForElement = (selector: string, timeout = 10000): Promise<Element> => {
    return new Promise((resolve, reject) => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);

        const observer = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el) {
                observer.disconnect();
                resolve(el);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms.`));
        }, timeout);
    });
};

const waitForElementToDisappear = (selector: string, timeout = 10000): Promise<void> => {
    return new Promise((resolve, reject) => {
        // If the element doesn't exist to begin with, we're done.
        if (!document.querySelector(selector)) {
            return resolve();
        }

        const observer = new MutationObserver(() => {
            if (!document.querySelector(selector)) {
                observer.disconnect();
                resolve();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Failsafe timeout
        setTimeout(() => {
            observer.disconnect();
            // Final check
            if (!document.querySelector(selector)) {
                resolve();
            } else {
                reject(new Error(`Element with selector "${selector}" did not disappear within ${timeout}ms.`));
            }
        }, timeout);
    });
};

const getBasePriceInput = async (): Promise<HTMLInputElement> => {
    try {
        return await waitForElement(
            'input[data-testid="base-price-input"], input[name="basePrice"], input[id="basePrice"], input[name="base_price"], input[id="base_price"]'
        ) as HTMLInputElement;
    } catch {
        const label = Array.from(document.querySelectorAll('label')).find(el => /base price/i.test(el.textContent || ''));
        const input = label?.closest('div')?.querySelector('input');
        if (input) return input as HTMLInputElement;
        throw new Error('Base price input not found');
    }
};

const getSaveRefreshButton = async (): Promise<HTMLElement> => {
    try {
        return await waitForElement(
            'button[data-testid="save-and-refresh-button"], button[data-testid="save-and-refresh"], button[id="save-and-refresh-button"], button[id="save-and-refresh"], button[data-testid="save-refresh-button"], button[id="save-refresh-button"]'
        ) as HTMLElement;
    } catch {
        const btn = Array.from(document.querySelectorAll('button')).find(el => /save\s*&?\s*refresh/i.test(el.textContent || ''));
        if (btn) return btn as HTMLElement;
        throw new Error('Save and refresh button not found');
    }
};

chrome.runtime.onMessage.addListener((message: ContentScriptMessage, sender, sendResponse) => {
    console.log('Content script received message:', message);

    const handleMessage = async (): Promise<ContentScriptResponse> => {
        try {
            switch (message.type) {
                case 'GET_BASE_PRICE': {
                    const input = await getBasePriceInput();
                    return { type: 'BASE_PRICE_RESPONSE', price: parseFloat(input.value) };
                }
                case 'SET_BASE_PRICE': {
                    const input = await getBasePriceInput();
                    input.click();
                    input.focus();
                    input.value = message.price.toString();
                    // Dispatch events to make sure the web app's framework (e.g., React) picks up the change.
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    return { type: 'SUCCESS' };
                }
                case 'CLICK_SAVE_REFRESH': {
                    const button = await getSaveRefreshButton();
                    button.click();
                    return { type: 'SUCCESS' };
                }
                case 'CLICK_ELEMENT': {
                    const button = await waitForElement(message.selector) as HTMLElement;
                    button.click();
                    return { type: 'SUCCESS' };
                }
                case 'WAIT_FOR_ELEMENT_TO_DISAPPEAR': {
                    await waitForElementToDisappear(message.selector);
                    return { type: 'SUCCESS' };
                }
                case 'WAIT_FOR_ELEMENT': {
                    await waitForElement(message.selector);
                    return { type: 'SUCCESS' };
                }
                case 'SELECT_AIRBNB_LISTING': {
                    // IMPORTANT: The selectors here are placeholders for Airbnb.
                    const LISTING_ITEM_SELECTOR = '[data-testid="listing-card"]'; // Selector for each listing in the sidebar
                    const SINGLE_CALENDAR_VIEW_SELECTOR = '[data-testid="single-listing-calendar"]'; // A unique element for the single calendar view

                    const listingElements = Array.from(document.querySelectorAll(LISTING_ITEM_SELECTOR));
                    const targetListing = listingElements.find(el => el.textContent?.includes(message.listingName));
                    
                    if (!targetListing) {
                        throw new Error(`Could not find an Airbnb listing with the name "${message.listingName}"`);
                    }

                    (targetListing as HTMLElement).click();

                    // Wait for the single listing calendar to appear, confirming the page has changed.
                    await waitForElement(SINGLE_CALENDAR_VIEW_SELECTOR);
                    return { type: 'SUCCESS' };
                }
                case 'TOGGLE_PRICE_TIPS': {
                     // This selector is a placeholder for the price tips toggle on Airbnb.
                    const toggle = await waitForElement('button[data-testid="price-tips-toggle"]');
                    (toggle as HTMLElement).click();
                    return { type: 'SUCCESS' };
                }
                default:
                    // This is a type-level check to ensure all message types are handled.
                    const _exhaustiveCheck: never = message;
                    return { type: 'ERROR', message: 'Unknown message type' };
            }
        } catch (error) {
            return { type: 'ERROR', message: error instanceof Error ? error.message : 'An unknown error occurred in the content script.' };
        }
    };

    handleMessage().then(sendResponse);
    return true; // Indicates an asynchronous response.
});