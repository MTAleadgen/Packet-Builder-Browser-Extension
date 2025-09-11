import type { ContentScriptMessage, ContentScriptResponse } from './types';

// FIX: Use a global declaration for 'chrome' to resolve TypeScript errors when @types/chrome is not available.
declare const chrome: any;

// This script is injected into the target pages to interact with the DOM.

const waitForElement = (selector: string, timeout = 10000): Promise<Element> => {
    return new Promise((resolve, reject) => {
        // Check immediately
        const el = document.querySelector(selector);
        if (el) {
            console.log(`✅ Element found immediately: ${selector}`);
            return resolve(el);
        }

        console.log(`⏳ Waiting for element: ${selector} (timeout: ${timeout}ms)`);

        const observer = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el) {
                console.log(`✅ Element found via observer: ${selector}`);
                observer.disconnect();
                resolve(el);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeOldValue: true
        });

        setTimeout(() => {
            observer.disconnect();
            console.log(`❌ Element not found within timeout: ${selector}`);
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

const findBasePriceInputAttempt = (): HTMLInputElement | null => {
    console.log('🔍 Attempting to find base price input...');
    
    // First, let's debug what inputs are available on the page
    const allInputs = document.querySelectorAll('input') as NodeListOf<HTMLInputElement>;
    console.log('📊 Total inputs found on page:', allInputs.length);
    
    // Log all inputs with their values for debugging (only first attempt to avoid spam)
    if (allInputs.length > 0) {
        allInputs.forEach((input, index) => {
            const value = input.value;
            const type = input.type;
            const name = input.name;
            const id = input.id;
            const placeholder = input.placeholder;
            const ariaLabel = input.getAttribute('aria-label');
            const className = input.className;
            
            console.log(`📝 Input ${index}:`, {
                value,
                type,
                name,
                id,
                placeholder,
                ariaLabel,
                className
            });
        });
    }

    // Based on PriceLabs UI, look for the base price input field
    const selectors = [
        // Try common PriceLabs selectors first
        'input[data-testid="base-price-input"]',
        'input[name="basePrice"]',
        'input[id="basePrice"]',
        'input[name="base_price"]',
        'input[id="base_price"]',
        'input[name="base"]',
        'input[id="base"]',
        // Look for inputs with base-related labels or placeholders
        'input[aria-label*="base" i]',
        'input[placeholder*="base" i]',
        // Look for inputs in forms with base-related text
        'form input[type="number"]',
        'form input[type="text"]',
        // Generic number inputs that might contain pricing data
        'input[type="number"]',
        'input[type="text"]'
    ];

    console.log('🎯 Trying selectors for base price input...');
    for (const selector of selectors) {
        try {
            const elements = document.querySelectorAll(selector) as NodeListOf<HTMLInputElement>;
            console.log(`🔍 Selector "${selector}" found ${elements.length} elements`);
            
            for (const el of elements) {
                const rawValue = el.value;
                const value = rawValue.replace(/[^0-9.-]/g, '');
                const price = parseFloat(value);
                
                console.log(`💰 Checking input with raw value: "${rawValue}", parsed: ${price}`);
                
                // Check if this looks like a base price (reasonable range)
                if (!isNaN(price) && price > 0 && price < 10000) {
                    // Additional validation: check if nearby text contains "base"
                    const parent = el.closest('div, fieldset, section, form');
                    const nearbyText = parent?.textContent?.toLowerCase() || '';
                    
                    console.log(`🔍 Nearby text for input with value ${price}:`, nearbyText.substring(0, 200));
                    
                    // If we find "base" or "minimum" nearby, this is likely our field
                    if (nearbyText.includes('base') || nearbyText.includes('minimum')) {
                        console.log('✅ Found base price input with value:', price, 'selector:', selector);
                return el;
            }
                    // If no specific text found but it's a reasonable price, keep it as fallback
                    if (price >= 50 && price <= 1000) {
                        console.log('⚠️ Found potential base price input with value:', price, 'selector:', selector);
                        // Don't return yet, keep looking for a better match
                    }
                }
            }
        } catch (error) {
            console.log(`❌ Error with selector "${selector}":`, error);
        }
    }

    // Enhanced fallback: look specifically for the BASE price input (not minimum)
    console.log('🔍 Trying enhanced fallback detection for BASE field...');
    for (const input of allInputs) {
        const rawValue = input.value;
        const numericValue = parseFloat(rawValue.replace(/[^0-9.-]/g, ''));
        
        // Look for reasonable base price values
        if (!isNaN(numericValue) && numericValue >= 50 && numericValue <= 1000) {
            console.log('🎯 Found input with reasonable price value:', numericValue);
            
            // Check if this is the BASE field, not MINIMUM
            const parent = input.closest('div, fieldset, section, form');
            const nearbyText = parent?.textContent?.toLowerCase() || '';
            const inputContainer = input.parentElement;
            const containerText = inputContainer?.textContent?.toLowerCase() || '';
            
            console.log('🔍 Container text:', containerText.substring(0, 100));
            console.log('🔍 Nearby text:', nearbyText.substring(0, 200));
            
            // Specifically look for "base" and avoid "minimum"
            const hasBase = nearbyText.includes('base') || containerText.includes('base');
            const hasMinimum = nearbyText.includes('minimum') || containerText.includes('minimum') || nearbyText.includes('min');
            
            if (hasBase && !hasMinimum) {
                console.log('✅ Found BASE price input (not minimum):', numericValue);
                const style = window.getComputedStyle(input);
                if (style.display !== 'none' && style.visibility !== 'hidden' && !input.disabled && !input.readOnly) {
                    return input;
                }
            } else if (hasMinimum) {
                console.log('⚠️ Skipping MINIMUM field, looking for BASE field');
                continue;
            }
            
            // If no specific text found, check position/order (Base is usually after Minimum)
            // Force selection of the BASE field by position - it should be the 2nd price input
            const allPriceInputs = Array.from(allInputs).filter(inp => {
                const val = parseFloat(inp.value.replace(/[^0-9.-]/g, ''));
                return !isNaN(val) && val >= 50 && val <= 1000;
            });
            
            const currentIndex = allPriceInputs.indexOf(input);
            console.log(`🔍 Found price input at index ${currentIndex} with value ${numericValue}`);
            
            // SMART LOGIC: Skip first input (minimum) and continue collecting all price inputs
            // We'll select the BASE field using smarter logic below
            if (currentIndex === 0) {
                console.log('⚠️ Skipping 1st price input (this is likely the MINIMUM field)');
                continue;
            }
            
            // Continue to collect all price inputs for smart selection below
        }
    }

    // CRITICAL FIX: Force selection of BASE field (middle input, not minimum)
    console.log('🔍 CRITICAL FIX: Looking for all price inputs to select BASE field...');
    const allPriceInputs = Array.from(allInputs).filter(inp => {
        const val = parseFloat(inp.value.replace(/[^0-9.-]/g, ''));
        
        // Must be a reasonable price value
        if (isNaN(val) || val < 50 || val > 1000) return false;
        
        // Must be a number input field, not checkbox or other types
        if (inp.className.includes('checkbox')) {
            console.log('🚫 Excluding checkbox input with value:', val, 'className:', inp.className);
            return false;
        }
        
        // Must be a proper number input field (look for number input classes)
        if (!inp.className.includes('numberinput') && inp.type !== 'number' && inp.type !== 'text') {
            console.log('🚫 Excluding non-number input with value:', val, 'type:', inp.type, 'className:', inp.className);
            return false;
        }
        
        console.log('✅ Including price input with value:', val, 'className:', inp.className);
        return true;
    });
    
    console.log('📊 Found price inputs:', allPriceInputs.map((inp, idx) => ({
        index: idx,
        value: inp.value,
        parsedValue: parseFloat(inp.value.replace(/[^0-9.-]/g, '')),
        className: inp.className,
        id: inp.id,
        name: inp.name
    })));
    
    // Additional debugging: let's see the actual order of ALL inputs on the page
    console.log('🔍 DEBUGGING: All inputs with price values in DOM order:');
    Array.from(allInputs).forEach((inp, idx) => {
        const val = parseFloat(inp.value.replace(/[^0-9.-]/g, ''));
        if (!isNaN(val) && val >= 50 && val <= 1000) {
            console.log(`📍 DOM Input ${idx}: value=${val}, className="${inp.className}", id="${inp.id}", name="${inp.name}"`);
        }
    });
    
    if (allPriceInputs.length === 3) {
        // SMART SELECTION: Sort by value and select the middle one (Base should be between Min and Max)
        const sortedInputs = [...allPriceInputs].sort((a, b) => {
            const aVal = parseFloat(a.value.replace(/[^0-9.-]/g, ''));
            const bVal = parseFloat(b.value.replace(/[^0-9.-]/g, ''));
            return aVal - bVal;
        });
        
        // The middle value should be the Base price
        const baseInput = sortedInputs[1]; // Middle value = Base
        const baseValue = parseFloat(baseInput.value.replace(/[^0-9.-]/g, ''));
        const minValue = parseFloat(sortedInputs[0].value.replace(/[^0-9.-]/g, ''));
        const maxValue = parseFloat(sortedInputs[2].value.replace(/[^0-9.-]/g, ''));
        
        console.log('🎯 SMART SELECTION: Found exactly 3 price inputs (excluding checkbox)');
        console.log('📊 Minimum:', minValue, '| Base:', baseValue, '| Maximum:', maxValue);
        console.log('✅ Selecting BASE field with value:', baseValue);
        return baseInput;
    } else if (allPriceInputs.length > 3) {
        // If we have more than 3, try to find the best 3 by excluding obvious outliers
        console.log('⚠️ Found', allPriceInputs.length, 'price inputs, trying to identify the main 3...');
        const sortedInputs = [...allPriceInputs].sort((a, b) => {
            const aVal = parseFloat(a.value.replace(/[^0-9.-]/g, ''));
            const bVal = parseFloat(b.value.replace(/[^0-9.-]/g, ''));
            return aVal - bVal;
        });
        
        // Take the middle value as Base (skip first and last as they might be outliers)
        const middleIndex = Math.floor(sortedInputs.length / 2);
        const baseInput = sortedInputs[middleIndex];
        const baseValue = parseFloat(baseInput.value.replace(/[^0-9.-]/g, ''));
        
        console.log('🎯 Selecting middle value as BASE:', baseValue);
        return baseInput;
    } else if (allPriceInputs.length === 2) {
        // If only 2 inputs, assume [Minimum] [Base] - select the second one
        const baseInput = allPriceInputs[1];
        const baseValue = parseFloat(baseInput.value.replace(/[^0-9.-]/g, ''));
        console.log('🎯 SELECTING BASE FIELD (2nd of 2 inputs) with value:', baseValue);
        console.log('🎯 Skipping Minimum field (1st input) with value:', parseFloat(allPriceInputs[0].value.replace(/[^0-9.-]/g, '')));
        return baseInput;
    } else if (allPriceInputs.length === 1) {
        // If only one input found, this might be the base field
        const singleInput = allPriceInputs[0];
        const value = parseFloat(singleInput.value.replace(/[^0-9.-]/g, ''));
        console.log('🎯 Only one price input found, using it as BASE field with value:', value);
        return singleInput;
    }

    // Label-based detection as last resort
    console.log('🔍 Trying label-based detection...');
    const labels = Array.from(document.querySelectorAll('label, span, div'));
    for (const label of labels) {
        const text = label.textContent?.toLowerCase() || '';
        if (text.includes('base') && !text.includes('minimum')) {
            console.log('🏷️ Found label with base text:', text);
            
            const input = label.querySelector('input') || 
                         label.parentElement?.querySelector('input') ||
                         document.querySelector(`input[id="${label.getAttribute('for')}"]`);
                         
            if (input && input instanceof HTMLInputElement) {
                const value = input.value.replace(/[^0-9.-]/g, '');
                const price = parseFloat(value);
                if (!isNaN(price) && price > 0) {
                    console.log('✅ Found base price input via label with value:', price);
                    return input;
                }
            }
        }
    }

    console.log('❌ No base price input found in this attempt');
    return null;
};

const getBasePriceInput = async (): Promise<HTMLInputElement> => {
    console.log('🚀 Starting robust base price input detection...');
    
    const maxAttempts = 5;
    const delayBetweenAttempts = 1000; // 1 second
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`🔄 Attempt ${attempt}/${maxAttempts} to find base price input`);
        
        // Wait a bit for the page to load/render (except first attempt)
        if (attempt > 1) {
            console.log(`⏳ Waiting ${delayBetweenAttempts}ms before attempt ${attempt}...`);
            await new Promise(resolve => setTimeout(resolve, delayBetweenAttempts));
        }
        
        const input = findBasePriceInputAttempt();
        if (input) {
            console.log(`✅ Successfully found base price input on attempt ${attempt}`);
            return input;
        }
        
        if (attempt < maxAttempts) {
            console.log(`⚠️ Attempt ${attempt} failed, will retry...`);
        }
    }
    
    console.error('❌ Failed to find base price input after all attempts');
    throw new Error(`Base price input not found after ${maxAttempts} attempts. Please check the browser console for debugging information and ensure you are on the PriceLabs pricing page with the base price field visible.`);
};

const getSaveRefreshButton = async (): Promise<HTMLElement> => {
    await saveLog('🔍 Looking for Save & Refresh button...');
    console.log('🔍 Looking for Save & Refresh button...');

    // OPTIMIZED: Try selectors with much shorter timeout (500ms instead of 3000ms)
    const selectors = [
        'button[data-testid="save-and-refresh-button"]',
        'button[data-testid="save-and-refresh"]',
        'button[id="save-and-refresh-button"]',
        'button[id="save-and-refresh"]',
        'button[data-testid="save-refresh-button"]',
        'button[id="save-refresh-button"]',
        'button#rp-save-and-refresh',
        '#rp-save-and-refresh',
        'button[qa-id="save-and-refresh"]'
    ];

    for (const selector of selectors) {
        try {
            console.log(`- Trying selector: ${selector}`);
            // Reduced from 3000ms to 500ms to speed up detection
            const button = await waitForElement(selector, 500) as HTMLElement;
            if (button) {
                await saveLog('✅ Found Save & Refresh button with selector:', selector);
                console.log(`✅ Found Save & Refresh button with selector: ${selector}`, button);
                return button;
            }
        } catch {
            // Skip logging to avoid spam - only log successful finds
        }
    }

    // Fallback: search by button text content (optimized - no retry delays)
    await saveLog('🔍 Trying text-based detection for Save & Refresh button...');
    console.log('🔍 Trying text-based detection for Save & Refresh button...');

    const buttons = Array.from(document.querySelectorAll('button'));
    await saveLog(`📊 Found ${buttons.length} buttons on page`);
    console.log(`📊 Found ${buttons.length} buttons on page`);

    for (const btn of buttons) {
        const text = btn.textContent?.toLowerCase() || '';
        if (text.includes('save') && (text.includes('refresh') || text.includes('&'))) {
            await saveLog('✅ Found Save & Refresh button by text content:', btn.textContent);
            console.log('✅ Found Save & Refresh button by text content:', btn.textContent, btn);
            return btn as HTMLElement;
        }
    }

    throw new Error('Save & Refresh button not found. Please ensure you are on the PriceLabs pricing page.');
};

const setInput = (el: HTMLInputElement | HTMLTextAreaElement, val: string) => {
    const ownerWin = el.ownerDocument && el.ownerDocument.defaultView ? el.ownerDocument.defaultView : window;
    const proto = el.tagName === 'TEXTAREA' ? ownerWin.HTMLTextAreaElement.prototype : ownerWin.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
        setter.call(el, val);
    } else {
        // Fallback for browsers that don't support this
        (el as any).value = val;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
};

const realClick = (el: HTMLElement) => {
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(type =>
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
    );
};

const sendKey = (el: HTMLElement, key: string) => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
};

const waitForButtonEnabled = async (button: HTMLElement, timeoutMs: number = 15000) => {
    const start = Date.now();
    const isDisabled = () => (button as HTMLButtonElement).disabled || button.getAttribute('aria-disabled') === 'true' || getComputedStyle(button).pointerEvents === 'none';
    while (isDisabled()) {
        console.log('⏳ Save & Refresh appears disabled; waiting...');
        await new Promise(res => setTimeout(res, 250));
        if (Date.now() - start > timeoutMs) {
            console.warn('⌛ Timed out waiting for Save & Refresh to enable');
            break;
        }
    }
};

const waitForSaveCompletion = async (button: HTMLElement, timeoutMs: number = 20000) => {
    const start = Date.now();
    let seenBusy = false;
    console.log('🎯 Waiting for save completion signals (toast or loading toggle)');
    while (Date.now() - start < timeoutMs) {
        const disabled = (button as HTMLButtonElement).disabled || button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true';
        const dataLoadingAttr = button.getAttribute('data-loading');
        const dataLoading = dataLoadingAttr === 'true' || button.hasAttribute('data-loading');
        const busy = disabled || dataLoading;
        if (busy && !seenBusy) {
            console.log('📡 Button entered loading state', { disabled, dataLoadingAttr });
            seenBusy = true;
        }
        if (seenBusy && !busy) {
            console.log('✅ Button loading finished');
            return;
        }
        const toast = document.querySelector('[role="status"], [data-status], .chakra-toast, .Toastify__toast--success');
        const toastText = (toast && (toast.textContent || '').trim()) || '';
        if (toast && /saved|refresh|updated|success/i.test(toastText)) {
            console.log('✅ Detected success toast:', toastText);
            return;
        }
        await new Promise(res => setTimeout(res, 250));
    }
    console.warn('⌛ No explicit completion signal within timeout');
};

const getSyncNowButton = async (): Promise<HTMLElement> => {
    console.log('🔍 Looking for Sync Now button...');
    
    // DEVELOPMENT MODE: Return a dummy element to avoid actually syncing
    console.log('🚧 DEVELOPMENT MODE: Using dummy sync (no actual sync will occur)');
    console.log('ℹ️  In production, this would find the real Sync Now button on PriceLabs');
    
    // Create a dummy button element for development
    const dummyButton = document.createElement('button');
    dummyButton.textContent = 'Dummy Sync Button';
    dummyButton.style.display = 'none'; // Hide it from view
    document.body.appendChild(dummyButton);
    
    return dummyButton;
    
    /* PRODUCTION CODE - COMMENTED OUT FOR DEVELOPMENT
    // Look for the Sync Now button with various selectors
    const selectors = [
        'button[data-testid="sync-now-button"]',
        'button[data-testid="sync-now"]',
        'button[id="sync-now-button"]',
        'button[id="sync-now"]',
        'button[data-testid="sync-button"]',
        'button[id="sync-button"]'
    ];

    for (const selector of selectors) {
        try {
            const button = await waitForElement(selector, 3000) as HTMLElement;
            if (button) {
                console.log('✅ Found Sync Now button with selector:', selector);
                return button;
            }
    } catch {
            console.log(`⚠️ Selector "${selector}" not found, trying next...`);
        }
    }

    // Fallback: search by button text content with retry
    console.log('🔍 Trying text-based detection for Sync Now button...');
    const maxAttempts = 3;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`🔄 Text search attempt ${attempt}/${maxAttempts}`);
        
        const buttons = Array.from(document.querySelectorAll('button'));
        console.log(`📊 Found ${buttons.length} buttons on page`);
        
        for (const btn of buttons) {
            const text = btn.textContent?.toLowerCase() || '';
            if (text.includes('sync') && (text.includes('now') || text === 'sync')) {
                console.log('✅ Found Sync Now button by text content:', btn.textContent);
                return btn as HTMLElement;
            }
        }
        
        if (attempt < maxAttempts) {
            console.log('⏳ Sync Now button not found, waiting 1 second...');
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    throw new Error('Sync Now button not found. Please ensure the button is visible on the page.');
    */
};

// Find Edit button for PriceLabs final steps
const findEditButton = async (): Promise<HTMLElement> => {
    console.log('🔍 Looking for Edit button on PriceLabs page...');

    // Look for Edit button with common selectors
    const selectors = [
        'button[data-testid*="edit"]',
        'button[id*="edit"]',
        'button[class*="edit"]',
        'a[data-testid*="edit"]',
        'a[id*="edit"]',
        'a[class*="edit"]'
    ];

    for (const selector of selectors) {
        try {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                const text = element.textContent?.toLowerCase() || '';
                if (text.includes('edit') || text === 'edit') {
                    console.log('✅ Found Edit button with selector:', selector, 'text:', text);
                    return element as HTMLElement;
                }
            }
        } catch {
            console.log(`⚠️ Selector "${selector}" not found, trying next...`);
        }
    }

    // Fallback: search by button text content
    console.log('🔍 Trying text-based detection for Edit button...');
    const allElements = document.querySelectorAll('button, a, [role="button"]');
    for (const element of allElements) {
        const text = element.textContent?.toLowerCase().trim() || '';
        const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
        if (text === 'edit' || text.includes('edit') || ariaLabel.includes('edit')) {
            console.log('✅ Found Edit button by text/aria-label:', text || ariaLabel);
            return element as HTMLElement;
        }
    }

    // If no Edit button found, try a broader search
    console.log('🔍 No specific Edit button found, trying broader search...');
    for (const element of allElements) {
        const text = element.textContent?.toLowerCase().trim() || '';
        if (text.includes('edit') && text.length <= 20) { // Avoid false positives with long text
            console.log('✅ Found Edit button by broad text search:', text);
            return element as HTMLElement;
        }
    }

    console.log('⚠️ Edit button not found, using fallback dummy button');
    const dummyButton = document.createElement('button');
    dummyButton.textContent = 'Dummy Edit Button (Fallback)';
    dummyButton.style.display = 'none';
    document.body.appendChild(dummyButton);
    return dummyButton;

};

// Find Edit Now button for PriceLabs final steps
const findEditNowButton = async (): Promise<HTMLElement> => {
    console.log('🔍 Looking for Edit Now button on PriceLabs page...');

    // Look for Edit Now button with common selectors
    const selectors = [
        'button[data-testid*="edit-now"]',
        'button[id*="edit-now"]',
        'button[class*="edit-now"]',
        'button[data-testid*="edit"]',
        'button[id*="edit"]',
        'button[class*="edit"]'
    ];

    for (const selector of selectors) {
        try {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                const text = element.textContent?.toLowerCase() || '';
                if ((text.includes('edit') && text.includes('now')) || text.includes('edit now')) {
                    console.log('✅ Found Edit Now button with selector:', selector, 'text:', text);
                    return element as HTMLElement;
                }
            }
        } catch {
            console.log(`⚠️ Selector "${selector}" not found, trying next...`);
        }
    }

    // Fallback: search by button text content
    console.log('🔍 Trying text-based detection for Edit Now button...');
    const allElements = document.querySelectorAll('button, a, [role="button"]');
    for (const element of allElements) {
        const text = element.textContent?.toLowerCase().trim() || '';
        const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
        if ((text.includes('edit') && text.includes('now')) || text.includes('edit now') || ariaLabel.includes('edit now')) {
            console.log('✅ Found Edit Now button by text/aria-label:', text || ariaLabel);
            return element as HTMLElement;
        }
    }

    // If no Edit Now button found, try a broader search
    console.log('🔍 No specific Edit Now button found, trying broader search...');
    for (const element of allElements) {
        const text = element.textContent?.toLowerCase().trim() || '';
        if (text.includes('edit') && text.includes('now') && text.length <= 25) {
            console.log('✅ Found Edit Now button by broad text search:', text);
            return element as HTMLElement;
        }
    }

    console.log('⚠️ Edit Now button not found, using fallback dummy button');
    const dummyButton = document.createElement('button');
    dummyButton.textContent = 'Dummy Edit Now Button (Fallback)';
    dummyButton.style.display = 'none';
    document.body.appendChild(dummyButton);
    return dummyButton;

};

// Find Edit Now popup button for PriceLabs final steps
const findEditNowPopupButton = async (): Promise<HTMLElement> => {
    console.log('🔍 Looking for Edit Now popup button on PriceLabs page...');

    // Look for Edit Now popup button with common selectors (in modals/popups)
    const selectors = [
        'button[data-testid*="confirm"]',
        'button[id*="confirm"]',
        'button[class*="confirm"]',
        'button[data-testid*="edit-now"]',
        'button[id*="edit-now"]',
        'button[class*="edit-now"]'
    ];

    for (const selector of selectors) {
        try {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                const text = element.textContent?.toLowerCase() || '';
                // Check if this button is inside a modal/popup
                let parent = element.parentElement;
                let isInModal = false;
                while (parent) {
                    if (parent.getAttribute('role') === 'dialog' ||
                        parent.classList.contains('modal') ||
                        parent.classList.contains('popup') ||
                        parent.classList.contains('overlay')) {
                        isInModal = true;
                        break;
                    }
                    parent = parent.parentElement;
                }

                if (isInModal && (text.includes('confirm') || text.includes('edit') || text.includes('now'))) {
                    console.log('✅ Found Edit Now popup button with selector:', selector, 'text:', text);
                    return element as HTMLElement;
                }
            }
        } catch {
            console.log(`⚠️ Selector "${selector}" not found, trying next...`);
        }
    }

    // Fallback: search by button text content in modal/popups
    console.log('🔍 Trying text-based detection for Edit Now popup button...');
    const allElements = document.querySelectorAll('button, a, [role="button"]');
    for (const element of allElements) {
        const text = element.textContent?.toLowerCase().trim() || '';
        const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';

        // Check if this button is inside a modal/popup
        let parent = element.parentElement;
        let isInModal = false;
        while (parent) {
            if (parent.getAttribute('role') === 'dialog' ||
                parent.classList.contains('modal') ||
                parent.classList.contains('popup') ||
                parent.classList.contains('overlay')) {
                isInModal = true;
                break;
            }
            parent = parent.parentElement;
        }

        if (isInModal && (text.includes('confirm') || text.includes('edit') || text === 'ok' || text === 'save')) {
            console.log('✅ Found Edit Now popup button by text/aria-label:', text || ariaLabel);
            return element as HTMLElement;
        }
    }

    console.log('⚠️ Edit Now popup button not found, using fallback dummy button');
    const dummyButton = document.createElement('button');
    dummyButton.textContent = 'Dummy Edit Now Popup Button (Fallback)';
    dummyButton.style.display = 'none';
    document.body.appendChild(dummyButton);
    return dummyButton;

};

// Individual step functions for occupancy download
const occupancyStep1Edit = async (): Promise<void> => {
    console.log('📝 Occupancy Step 1: Looking for Edit button...');
    
    // Search by text content for Edit button
    const buttons = Array.from(document.querySelectorAll('button, a'));
    for (const btn of buttons) {
        const text = btn.textContent?.toLowerCase().trim() || '';
        if (text === 'edit') {
            console.log('✅ Found Edit button by text content:', btn.textContent);
            btn.click();
            console.log('✅ Clicked Edit button');
            return;
        }
    }
    
    throw new Error('Edit button not found. Please ensure you are on the main PriceLabs page.');
};

const occupancyStep2ScrollAndFindEditProfile = async (): Promise<void> => {
    console.log('📝 Occupancy Step 2: Scrolling down to find Edit Profile button...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for page to load
    
    // First, try to find Edit Profile button without scrolling
    let editProfileButton = await findEditProfileButton();
    
    if (!editProfileButton) {
        console.log('🔍 Edit Profile button not visible, scrolling down...');
        
        // Scroll down in increments to find the Edit Profile button
        const maxScrollAttempts = 5;
        const scrollAmount = 500; // pixels
        
        for (let i = 0; i < maxScrollAttempts; i++) {
            window.scrollBy(0, scrollAmount);
            console.log(`📜 Scrolled down ${scrollAmount * (i + 1)}px (attempt ${i + 1}/${maxScrollAttempts})`);
            
            // Wait for content to load after scroll
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Try to find the button again
            editProfileButton = await findEditProfileButton();
            if (editProfileButton) {
                console.log('✅ Found Edit Profile button after scrolling!');
                break;
            }
        }
    }
    
    if (!editProfileButton) {
        throw new Error('Edit Profile button not found even after scrolling. Check if you are on the correct page.');
    }
    
    // Click the Edit Profile button
    editProfileButton.click();
    console.log('✅ Clicked Edit Profile button');
};

const findEditProfileButton = async (): Promise<HTMLElement | null> => {
    console.log('🔍 Looking for Edit Profile button...');
    
    // Try multiple selectors for Edit Profile button
    const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"]'));
    
    for (const btn of buttons) {
        const text = btn.textContent?.toLowerCase().trim() || '';
        if (text.includes('edit profile') || text === 'edit profile') {
            console.log('✅ Found Edit Profile button by text content:', btn.textContent);
            return btn as HTMLElement;
        }
    }
    
    console.log('⚠️ Edit Profile button not found in current view');
    return null;
};

// REMOVED: occupancyStep3OccupancyBased - no longer needed since we're going directly to Edit Profile

const occupancyStep4EditProfile = async (): Promise<void> => {
    console.log('📝 Occupancy Step 4: Looking for Edit Profile button...');
    await new Promise(resolve => setTimeout(resolve, 2500)); // Wait longer for page to load
    
    const buttons = Array.from(document.querySelectorAll('button, a'));
    for (const btn of buttons) {
        const text = btn.textContent?.toLowerCase() || '';
        if (text.includes('edit profile') || text.includes('edit table')) {
            console.log('✅ Found Edit Profile button by text content:', btn.textContent);
            btn.click();
            console.log('✅ Clicked Edit Profile button');
            return;
        }
    }
    
    throw new Error('Edit Profile button not found.');
};

const occupancyStep5ConfirmEdit = async (): Promise<void> => {
    console.log('📝 Occupancy Step 3: Looking for Edit Profile button in popup...');
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait longer for popup to load
    
    // ULTRA COMPREHENSIVE POPUP BUTTON DETECTION
    console.log('🔍 DEBUGGING: Looking for Edit Profile button in popup dialog...');
    
    // Log the entire page structure for debugging
    console.log('🌐 Page title:', document.title);
    console.log('🌐 Current URL:', window.location.href);
    
    // Find ALL elements that could be buttons or clickable
    const allClickableElements = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"], [onclick], a, div[onclick], span[onclick]'));
    console.log('📊 TOTAL clickable elements found:', allClickableElements.length);
    
    // Debug EVERY clickable element
    allClickableElements.forEach((el, index) => {
        const text = el.textContent?.trim() || '';
        const tagName = el.tagName.toLowerCase();
        const className = (el as HTMLElement).className || '';
        const id = (el as HTMLElement).id || '';
        const role = (el as HTMLElement).getAttribute('role') || '';
        
        console.log(`🔍 Element ${index} [${tagName}]:`, {
            text: text,
            className: className,
            id: id,
            role: role,
            disabled: (el as HTMLButtonElement).disabled,
            visible: (el as HTMLElement).offsetParent !== null
        });
        
        // Highlight potential matches
        if (text.toLowerCase().includes('edit') || text.toLowerCase().includes('profile')) {
            console.log('🎯 POTENTIAL MATCH:', text, 'on element:', tagName, className);
        }
    });
    
    // Look for popup/modal containers
    const modalContainers = Array.from(document.querySelectorAll('div[role="dialog"], .modal, .popup, [class*="modal"], [class*="dialog"], [class*="popup"], [data-testid*="modal"], [data-testid*="dialog"]'));
    console.log('📊 Modal containers found:', modalContainers.length);
    
    modalContainers.forEach((container, index) => {
        console.log(`📦 Modal Container ${index}:`, {
            className: (container as HTMLElement).className,
            id: (container as HTMLElement).id,
            innerHTML: (container as HTMLElement).innerHTML.substring(0, 200) + '...'
        });
    });
    
    // Try to find Edit Profile button with various strategies (REORDERED FOR PRIORITY)
    const strategies = [
        // Strategy 1: Look for specific button class css-tbj7bz FIRST (from logs)
        () => {
            console.log('🎯 Strategy 1 (PRIORITY): Look for css-tbj7bz button class');
            const specificButtons = Array.from(document.querySelectorAll('button.css-tbj7bz, button[class*="tbj7bz"]'));
            console.log('🔍 Found', specificButtons.length, 'buttons with css-tbj7bz class');
            
            for (const btn of specificButtons) {
                const text = btn.textContent?.trim().toLowerCase();
                console.log('🔍 Checking css-tbj7bz button text:', text);
                
                if (text === 'edit profile') {
                    console.log('🎯 PRIORITY TARGET FOUND: Edit Profile button with css-tbj7bz class!');
                    return btn;
                }
            }
            return null;
        },
        
        // Strategy 2: Exact text match IN POPUP CONTEXT ONLY with validation
        () => {
            console.log('🎯 Strategy 2: Exact text match in popup context with validation');
            
            // Find all "Edit Profile" buttons
            const allEditProfileButtons = Array.from(document.querySelectorAll('*')).filter(el => {
                const text = el.textContent?.trim();
                return text === 'Edit Profile';
            });
            
            console.log('🔍 Found', allEditProfileButtons.length, '"Edit Profile" buttons total');
            
            // Try to find the one in a modal container first
            for (const modal of modalContainers) {
                const elements = Array.from(modal.querySelectorAll('*'));
                const found = elements.find(el => {
                    const text = el.textContent?.trim();
                    if (text !== 'Edit Profile') return false;
                    
                    // Additional validation: should be a button element
                    if (el.tagName.toLowerCase() !== 'button') return false;
                    
                    // Check if it's actually visible and clickable
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden') return false;
                    
                    console.log('🎯 Found valid "Edit Profile" button inside modal container:', {
                        className: (el as HTMLElement).className,
                        tagName: el.tagName,
                        visible: style.display !== 'none' && style.visibility !== 'hidden'
                    });
                    return true;
                });
                if (found) return found;
            }
            
            // If not found in modals, look for the popup-specific one
            // The popup Edit Profile button should have specific styling (yellow background)
            return allEditProfileButtons.find(el => {
                const style = window.getComputedStyle(el);
                const parent = el.closest('[role="dialog"], .modal, .popup, [class*="modal"], [class*="dialog"], [class*="popup"]');
                
                // Must be in a modal-like container
                if (!parent) return false;
                
                // Must be a button
                if (el.tagName.toLowerCase() !== 'button') return false;
                
                // Must be visible
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                
                // Check for yellow/primary styling (from your image)
                const hasYellowStyling = style.backgroundColor.includes('yellow') || 
                                       style.backgroundColor.includes('rgb(255, 255, 0)') ||
                                       (el as HTMLElement).className.includes('primary') ||
                                       (el as HTMLElement).className.includes('tbj7bz'); // From your logs
                
                if (hasYellowStyling) {
                    console.log('🎯 Found yellow-styled "Edit Profile" button in modal:', {
                        className: (el as HTMLElement).className,
                        backgroundColor: style.backgroundColor,
                        parentClassName: parent.className
                    });
                    return true;
                }
                
                return false;
            });
        },
        
        // Strategy 2: Case insensitive text match
        () => {
            console.log('🎯 Strategy 2: Case insensitive');
            return Array.from(document.querySelectorAll('*')).find(el => {
                const text = el.textContent?.trim().toLowerCase();
                return text === 'edit profile';
            });
        },
        
        // Strategy 3: Contains text match
        () => {
            console.log('🎯 Strategy 3: Contains text');
            return Array.from(document.querySelectorAll('*')).find(el => {
                const text = el.textContent?.trim().toLowerCase();
                return text.includes('edit profile');
            });
        },
        
        // Strategy 4: Button elements only
        () => {
            console.log('🎯 Strategy 4: Button elements only');
            return Array.from(document.querySelectorAll('button')).find(btn => {
                const text = btn.textContent?.trim().toLowerCase();
                return text.includes('edit') && text.includes('profile');
            });
        },
        
        // Strategy 5: Yellow/highlighted elements IN POPUP
        () => {
            console.log('🎯 Strategy 5: Yellow/highlighted elements in popup');
            // Look for yellow/highlighted buttons specifically in modal containers
            for (const modal of modalContainers) {
                const highlightedElements = Array.from(modal.querySelectorAll('button[style*="yellow"], button[class*="yellow"], button[style*="background"], button[class*="primary"], button[class*="highlight"], button'));
                const found = highlightedElements.find(el => {
                    const text = el.textContent?.trim().toLowerCase();
                    const style = window.getComputedStyle(el);
                    
                    // Check for "Edit Profile" text
                    if (text === 'edit profile') {
                        console.log('🎯 Found yellow/highlighted "Edit Profile" button in modal');
                        return true;
                    }
                    
                    // Check for yellow background or primary styling
                    if ((text.includes('edit') && text.includes('profile')) && 
                        (style.backgroundColor.includes('yellow') || 
                         style.backgroundColor.includes('rgb(255, 255, 0)') ||
                         el.className.includes('primary') ||
                         el.className.includes('yellow'))) {
                        console.log('🎯 Found styled Edit Profile button:', style.backgroundColor, el.className);
                        return true;
                    }
                    
                    return false;
                });
                if (found) return found;
            }
            return null;
        },
        
        // Strategy 6: Look inside modal containers (generic)
        () => {
            console.log('🎯 Strategy 6: Inside modal containers (generic)');
            for (const modal of modalContainers) {
                const buttons = modal.querySelectorAll('button, [role="button"], input[type="button"]');
                for (const btn of buttons) {
                    const text = btn.textContent?.trim().toLowerCase();
                    if (text.includes('edit') && text.includes('profile')) {
                        return btn;
                    }
                }
            }
            return null;
        }
    ];
    
    // Try each strategy
    for (let i = 0; i < strategies.length; i++) {
        try {
            const element = strategies[i]();
            if (element) {
                console.log(`✅ Strategy ${i + 1} SUCCESS! Found element:`, {
                    tagName: element.tagName,
                    textContent: element.textContent?.trim(),
                    className: (element as HTMLElement).className,
                    id: (element as HTMLElement).id
                });
                
                // Try to click it
                console.log('🖱️ Attempting to click the element...');
                (element as HTMLElement).click();
                console.log('✅ Successfully clicked Edit Profile button!');
                return;
            } else {
                console.log(`❌ Strategy ${i + 1} failed - no element found`);
            }
        } catch (error) {
            console.log(`❌ Strategy ${i + 1} error:`, error);
        }
    }
    
    // If we get here, nothing worked
    console.log('❌ ALL STRATEGIES FAILED');
    console.log('🔍 Final attempt: Looking for ANY element with "Edit Profile" text...');
    
    // Last resort: find any element with the text and try to find a clickable parent
    const textElements = Array.from(document.querySelectorAll('*')).filter(el => {
        const text = el.textContent?.trim();
        return text === 'Edit Profile';
    });
    
    console.log('📊 Elements containing "Edit Profile" text:', textElements.length);
    
    for (const textEl of textElements) {
        console.log('🔍 Checking element with "Edit Profile" text:', {
            tagName: textEl.tagName,
            className: (textEl as HTMLElement).className,
            parentTagName: textEl.parentElement?.tagName,
            parentClassName: textEl.parentElement?.className
        });
        
        // Try clicking the element itself
        try {
            (textEl as HTMLElement).click();
            console.log('✅ Successfully clicked text element!');
            return;
        } catch (e) {
            console.log('❌ Failed to click text element:', e);
        }
        
        // Try clicking the parent
        if (textEl.parentElement) {
            try {
                textEl.parentElement.click();
                console.log('✅ Successfully clicked parent element!');
                return;
            } catch (e) {
                console.log('❌ Failed to click parent element:', e);
            }
        }
    }
    
    throw new Error('❌ Could not find or click Edit Profile button in popup. Check console for extensive debugging info.');
};

const occupancyStep6Download = async (): Promise<void> => {
    console.log('📝 Occupancy Step 6: Looking for Download button in popup...');
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for popup to fully load
    
    // EXTENSIVE DEBUGGING: Let's see ALL the modal containers
    const modalContainers = Array.from(document.querySelectorAll([
        '[role="dialog"]',
        '[role="modal"]', 
        '.chakra-modal__content',
        '.modal',
        '.popup',
        '[data-testid*="modal"]',
        '[class*="modal"]',
        '[class*="popup"]',
        '[class*="dialog"]'
    ].join(', ')));
    
    console.log('📊 Modal containers found for download:', modalContainers.length);
    
    // DEBUG: Log details about each modal container
    modalContainers.forEach((modal, index) => {
        const isVisible = (modal as HTMLElement).offsetParent !== null;
        const zIndex = window.getComputedStyle(modal as HTMLElement).zIndex;
        const className = (modal as HTMLElement).className;
        const id = (modal as HTMLElement).id;
        const rect = modal.getBoundingClientRect();
        
        console.log(`📦 Modal ${index}:`, {
            visible: isVisible,
            zIndex: zIndex,
            className: className,
            id: id,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            left: rect.left
        });
        
        // Look for download buttons in this specific modal
        const downloadButtons = Array.from(modal.querySelectorAll('button, a, [role="button"]')).filter(btn => {
            const text = btn.textContent?.trim().toLowerCase();
            const title = btn.getAttribute('title')?.toLowerCase();
            return text?.includes('download') || title?.includes('download');
        });
        
        console.log(`🔍 Modal ${index} has ${downloadButtons.length} download buttons`);
        
        downloadButtons.forEach((btn, btnIndex) => {
            const text = btn.textContent?.trim();
            const title = btn.getAttribute('title');
            const btnVisible = (btn as HTMLElement).offsetParent !== null;
            const btnEnabled = !(btn as HTMLButtonElement).disabled;
            const btnClassName = (btn as HTMLElement).className;
            const btnRect = btn.getBoundingClientRect();
            
            console.log(`  🔍 Button ${btnIndex} in Modal ${index}:`, {
                text: text,
                title: title,
                visible: btnVisible,
                enabled: btnEnabled,
                className: btnClassName,
                width: btnRect.width,
                height: btnRect.height,
                top: btnRect.top,
                left: btnRect.left
            });
        });
    });
    
    // Strategy 1: Look for the TOPMOST/HIGHEST z-index modal with download buttons
    let topModal = null;
    let highestZIndex = -1;
    
    for (const modal of modalContainers) {
        const isVisible = (modal as HTMLElement).offsetParent !== null;
        if (!isVisible) continue;
        
        const zIndex = parseInt(window.getComputedStyle(modal as HTMLElement).zIndex) || 0;
        
        // Check if this modal has download buttons
        const downloadButtons = Array.from(modal.querySelectorAll('button, a, [role="button"]')).filter(btn => {
            const text = btn.textContent?.trim().toLowerCase();
            const title = btn.getAttribute('title')?.toLowerCase();
            return text?.includes('download') || title?.includes('download');
        });
        
        if (downloadButtons.length > 0 && zIndex > highestZIndex) {
            highestZIndex = zIndex;
            topModal = modal;
            console.log('🎯 New top modal candidate with z-index:', zIndex, 'and', downloadButtons.length, 'download buttons');
        }
    }
    
    if (topModal) {
        console.log('🎯 Using TOP MODAL with highest z-index:', highestZIndex);
        
        const downloadButtons = Array.from(topModal.querySelectorAll('button, a, [role="button"]')).filter(btn => {
            const text = btn.textContent?.trim().toLowerCase();
            const title = btn.getAttribute('title')?.toLowerCase();
            return text?.includes('download') || title?.includes('download');
        });
        
        for (const btn of downloadButtons) {
            const text = btn.textContent?.trim();
            const title = btn.getAttribute('title');
            const isVisible = (btn as HTMLElement).offsetParent !== null;
            const isEnabled = !(btn as HTMLButtonElement).disabled;
            
            console.log('🔍 Top modal download button:', {
                text: text,
                title: title,
                visible: isVisible,
                enabled: isEnabled,
                className: (btn as HTMLElement).className
            });
            
            if (isVisible && isEnabled) {
                console.log('🎯 FOUND TOP MODAL DOWNLOAD BUTTON:', text || title);
                (btn as HTMLElement).click();
                console.log('✅ Clicked top modal Download button - file should start downloading');
                return;
            }
        }
    }
    
    // Strategy 2: Look for EXACT "Download" text (not "Download Prices" or "Download as CSV")
    console.log('🔍 Strategy 2: Looking for EXACT "Download" text...');
    const allButtons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    
    for (const btn of allButtons) {
        const text = btn.textContent?.trim();
        
        // Look for EXACTLY "Download" (case insensitive)
        if (text?.toLowerCase() === 'download') {
            const isVisible = (btn as HTMLElement).offsetParent !== null;
            const isEnabled = !(btn as HTMLButtonElement).disabled;
            const rect = btn.getBoundingClientRect();
            
            console.log('🎯 FOUND EXACT "Download" BUTTON:', {
                text: text,
                visible: isVisible,
                enabled: isEnabled,
                className: (btn as HTMLElement).className,
                width: rect.width,
                height: rect.height,
                top: rect.top,
                left: rect.left
            });
            
            if (isVisible && isEnabled) {
                console.log('✅ Clicking EXACT "Download" button');
                (btn as HTMLElement).click();
                console.log('✅ Clicked exact Download button - file should start downloading');
                return;
            }
        }
    }
    
    // Strategy 3: Look for yellow/highlighted download button
    console.log('🔍 Strategy 3: Looking for highlighted download button...');
    const highlightButtons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    
    for (const btn of highlightButtons) {
        const text = btn.textContent?.trim().toLowerCase();
        const title = btn.getAttribute('title')?.toLowerCase();
        
        if (!(text?.includes('download') || title?.includes('download'))) continue;
        
        const styles = window.getComputedStyle(btn as HTMLElement);
        const className = (btn as HTMLElement).className;
        
        // Check for yellow/primary styling or specific classes
        const isHighlighted = styles.backgroundColor.includes('255, 193, 7') || // Bootstrap yellow
                            styles.backgroundColor.includes('yellow') ||
                            className.includes('yellow') ||
                            className.includes('primary') ||
                            className.includes('highlight') ||
                            className.includes('btn-warning'); // Bootstrap warning (yellow)
        
        if (isHighlighted) {
            console.log('🎯 FOUND HIGHLIGHTED DOWNLOAD BUTTON:', btn.textContent?.trim() || btn.getAttribute('title'));
            (btn as HTMLElement).click();
            console.log('✅ Clicked highlighted Download button - file should start downloading');
            return;
        }
    }
    
    // Strategy 3: Generic download button (fallback)
    console.log('🔍 Strategy 3: Generic download button search...');
    const allDownloadButtons = Array.from(document.querySelectorAll('button, a')).filter(btn => {
        const text = btn.textContent?.toLowerCase() || '';
        const title = btn.getAttribute('title')?.toLowerCase() || '';
        return text.includes('download') || title.includes('download');
    });
    
    console.log('📊 Total download buttons found:', allDownloadButtons.length);
    
    for (let i = 0; i < allDownloadButtons.length; i++) {
        const btn = allDownloadButtons[i];
        console.log(`🔍 Download button ${i + 1}:`, btn.textContent?.trim() || btn.getAttribute('title'));
    }
    
    if (allDownloadButtons.length > 0) {
        // Try the first visible download button
        for (const btn of allDownloadButtons) {
            const isVisible = (btn as HTMLElement).offsetParent !== null;
            if (isVisible) {
                console.log('⚠️ Using fallback download button:', btn.textContent?.trim() || btn.getAttribute('title'));
                (btn as HTMLElement).click();
                console.log('✅ Clicked Download button - file should start downloading');
                return;
            }
        }
    }
    
    throw new Error('❌ No download button found in popup or page');
};


const occupancyStep7ClosePopup = async (): Promise<void> => {
    console.log('📝 Occupancy Step 7: Closing popup by clicking X button...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for download to start
    
    // Strategy 1: Look for X button in modal containers
    const modalContainers = Array.from(document.querySelectorAll([
        '[role="dialog"]',
        '[role="modal"]', 
        '.chakra-modal__content',
        '.modal',
        '.popup',
        '[data-testid*="modal"]',
        '[class*="modal"]',
        '[class*="popup"]',
        '[class*="dialog"]'
    ].join(', ')));
    
    console.log('🔍 Looking for X/close button in', modalContainers.length, 'modal containers');
    
    // Look for the topmost modal (highest z-index)
    let topModal = null;
    let highestZIndex = -1;
    
    for (const modal of modalContainers) {
        const isVisible = (modal as HTMLElement).offsetParent !== null;
        if (!isVisible) continue;
        
        const zIndex = parseInt(window.getComputedStyle(modal as HTMLElement).zIndex) || 0;
        
        if (zIndex > highestZIndex) {
            highestZIndex = zIndex;
            topModal = modal;
        }
    }
    
    if (topModal) {
        console.log('🎯 Looking for close button in top modal with z-index:', highestZIndex);
        
        // Look for close/X buttons in the top modal
        const closeButtons = Array.from(topModal.querySelectorAll('button, [role="button"], a')).filter(btn => {
            const text = btn.textContent?.trim().toLowerCase();
            const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase();
            const title = btn.getAttribute('title')?.toLowerCase();
            const className = (btn as HTMLElement).className.toLowerCase();
            
            return text === '×' || 
                   text === 'x' || 
                   text === 'close' ||
                   ariaLabel?.includes('close') ||
                   title?.includes('close') ||
                   className.includes('close') ||
                   className.includes('modal-close');
        });
        
        console.log('🔍 Found', closeButtons.length, 'potential close buttons in top modal');
        
        for (let i = 0; i < closeButtons.length; i++) {
            const btn = closeButtons[i];
            const text = btn.textContent?.trim();
            const ariaLabel = btn.getAttribute('aria-label');
            const className = (btn as HTMLElement).className;
            const isVisible = (btn as HTMLElement).offsetParent !== null;
            const isEnabled = !(btn as HTMLButtonElement).disabled;
            
            console.log(`🔍 Close button ${i + 1}:`, {
                text: text,
                ariaLabel: ariaLabel,
                className: className,
                visible: isVisible,
                enabled: isEnabled
            });
            
            if (isVisible && isEnabled) {
                console.log('🎯 FOUND CLOSE BUTTON:', text || ariaLabel || 'X');
                (btn as HTMLElement).click();
                console.log('✅ Clicked close button - popup should close');
                return;
            }
        }
    }
    
    // Strategy 2: Look for any X or close button on the page
    console.log('🔍 Strategy 2: Looking for any X/close button on page...');
    const allCloseButtons = Array.from(document.querySelectorAll('button, [role="button"], a')).filter(btn => {
        const text = btn.textContent?.trim();
        const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase();
        const title = btn.getAttribute('title')?.toLowerCase();
        
        return text === '×' || 
               text === 'X' || 
               text === 'x' ||
               text === 'Close' ||
               text === 'close' ||
               ariaLabel?.includes('close') ||
               title?.includes('close');
    });
    
    console.log('📊 Found', allCloseButtons.length, 'close buttons on page');
    
    for (const btn of allCloseButtons) {
        const isVisible = (btn as HTMLElement).offsetParent !== null;
        const isEnabled = !(btn as HTMLButtonElement).disabled;
        
        if (isVisible && isEnabled) {
            const text = btn.textContent?.trim();
            const ariaLabel = btn.getAttribute('aria-label');
            console.log('🎯 Using close button:', text || ariaLabel || 'X');
            (btn as HTMLElement).click();
            console.log('✅ Clicked close button - popup should close');
            return;
        }
    }
    
    console.log('⚠️ No close button found - popup may remain open');
};

const occupancyStep8Complete = async (): Promise<void> => {
    console.log('🎉 Occupancy Step 8: Download workflow completed!');
    await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause
};

const navigationStep1DynamicPricing = async (): Promise<void> => {
    console.log('📝 Navigation Step 1: Clicking Dynamic Pricing dropdown...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for page to settle
    
    // Strategy 1: Look for "Dynamic Pricing" text in clickable elements
    const clickableElements = Array.from(document.querySelectorAll('button, a, [role="button"], div[onclick], span[onclick], [tabindex]'));
    
    for (const element of clickableElements) {
        const text = element.textContent?.trim();
        
        if (text?.includes('Dynamic Pricing')) {
            const isVisible = (element as HTMLElement).offsetParent !== null;
            const isEnabled = !(element as HTMLButtonElement).disabled;
            
            console.log('🔍 Found Dynamic Pricing element:', {
                text: text,
                tagName: element.tagName,
                className: (element as HTMLElement).className,
                visible: isVisible,
                enabled: isEnabled
            });
            
            if (isVisible && isEnabled) {
                console.log('🎯 FOUND DYNAMIC PRICING DROPDOWN:', text);
                (element as HTMLElement).click();
                console.log('✅ Clicked Dynamic Pricing dropdown');
                return;
            }
        }
    }
    
    // Strategy 2: Look for dropdown/menu elements that might contain "Dynamic Pricing"
    console.log('🔍 Strategy 2: Looking for dropdown/menu elements...');
    const menuElements = Array.from(document.querySelectorAll([
        '[role="menuitem"]',
        '[role="menu"]',
        '.dropdown',
        '.menu',
        '[class*="dropdown"]',
        '[class*="menu"]',
        'nav a',
        'nav button'
    ].join(', ')));
    
    for (const element of menuElements) {
        const text = element.textContent?.trim();
        
        if (text?.includes('Dynamic') || text?.includes('Pricing')) {
            const isVisible = (element as HTMLElement).offsetParent !== null;
            
            console.log('🔍 Found menu element with Dynamic/Pricing:', {
                text: text,
                tagName: element.tagName,
                className: (element as HTMLElement).className,
                visible: isVisible
            });
            
            if (isVisible) {
                console.log('🎯 Clicking menu element:', text);
                (element as HTMLElement).click();
                console.log('✅ Clicked Dynamic Pricing menu element');
                return;
            }
        }
    }
    
    throw new Error('❌ Dynamic Pricing dropdown not found');
};

const navigationStep2Customizations = async (): Promise<void> => {
    console.log('📝 Navigation Step 2: Selecting Customizations from dropdown...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for dropdown to open
    
    // Strategy 1: Look for "Customizations" in dropdown/menu items
    const dropdownItems = Array.from(document.querySelectorAll([
        '[role="menuitem"]',
        '[role="option"]',
        '.dropdown-item',
        '.menu-item',
        '[class*="dropdown"] a',
        '[class*="menu"] a',
        '[class*="dropdown"] button',
        '[class*="menu"] button',
        'li a',
        'li button'
    ].join(', ')));
    
    console.log('🔍 Found', dropdownItems.length, 'potential dropdown items');
    
    for (let i = 0; i < dropdownItems.length; i++) {
        const item = dropdownItems[i];
        const text = item.textContent?.trim();
        const isVisible = (item as HTMLElement).offsetParent !== null;
        const isEnabled = !(item as HTMLButtonElement).disabled;
        
        console.log(`🔍 Dropdown item ${i + 1}:`, {
            text: text,
            tagName: item.tagName,
            className: (item as HTMLElement).className,
            visible: isVisible,
            enabled: isEnabled
        });
        
        if (text?.toLowerCase().includes('customizations') || text?.toLowerCase().includes('customization')) {
            if (isVisible && isEnabled) {
                console.log('🎯 FOUND CUSTOMIZATIONS OPTION:', text);
                (item as HTMLElement).click();
                console.log('✅ Clicked Customizations option');
                return;
            }
        }
    }
    
    // Strategy 2: Look for the BOTTOM option in the dropdown (as specified)
    console.log('🔍 Strategy 2: Looking for bottom option in dropdown...');
    const visibleItems = dropdownItems.filter(item => {
        const isVisible = (item as HTMLElement).offsetParent !== null;
        const isEnabled = !(item as HTMLButtonElement).disabled;
        return isVisible && isEnabled;
    });
    
    if (visibleItems.length > 0) {
        const bottomItem = visibleItems[visibleItems.length - 1];
        const text = bottomItem.textContent?.trim();
        
        console.log('🔍 Bottom dropdown option:', {
            text: text,
            tagName: bottomItem.tagName,
            className: (bottomItem as HTMLElement).className
        });
        
        if (text?.toLowerCase().includes('customizations') || text?.toLowerCase().includes('customization')) {
            console.log('🎯 FOUND BOTTOM CUSTOMIZATIONS OPTION:', text);
            (bottomItem as HTMLElement).click();
            console.log('✅ Clicked bottom Customizations option');
            return;
        } else {
            console.log('⚠️ Bottom option does not contain "Customizations":', text);
        }
    }
    
    throw new Error('❌ Customizations option not found in dropdown');
};

const navigationStep3Complete = async (): Promise<void> => {
    console.log('🎉 Navigation Step 3: Navigation to Customizations completed!');
    
    // Check if we're on the Customizations page
    const url = window.location.href;
    const title = document.title;
    
    console.log('🔍 Current page details:', {
        url: url,
        title: title,
        readyState: document.readyState
    });
    
    // Wait for page to be fully interactive
    if (document.readyState !== 'complete') {
        console.log('🔄 Waiting for page to complete loading...');
        await new Promise(resolve => {
            const checkReady = () => {
                if (document.readyState === 'complete') {
                    console.log('✅ Page is now complete');
                    resolve(undefined);
                } else {
                    setTimeout(checkReady, 500);
                }
            };
            checkReady();
        });
    }
    
    // Additional wait for React components to settle
    console.log('🔄 Waiting for React components to settle...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('✅ Page is ready for interaction');
};

const customizationsStep1Listings = async (): Promise<void> => {
    console.log('📝 Customizations Step 1: Selecting Listings tab...');
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for page to load
    
    // Enhanced Strategy: Look for "Listings" tab with multiple approaches
    console.log('🔍 Strategy 1: Looking for tab elements with "Listings" text...');
    
    // Strategy 1: Look for "Listings" in tab elements (broader search)
    const tabElements = Array.from(document.querySelectorAll([
        '[role="tab"]',
        '.tab',
        '[class*="tab"]',
        'button',
        'a',
        '[role="button"]',
        'li a',
        'li button',
        'div[onclick]',
        'span[onclick]',
        '[tabindex]',
        '.nav-item',
        '[class*="nav"]'
    ].join(', ')));
    
    console.log('🔍 Found', tabElements.length, 'potential tab elements');
    
    for (let i = 0; i < tabElements.length; i++) {
        const element = tabElements[i];
        const text = element.textContent?.trim();
        const isVisible = (element as HTMLElement).offsetParent !== null;
        const isEnabled = !(element as HTMLButtonElement).disabled;
        
        console.log(`🔍 Tab element ${i + 1}:`, {
            text: text,
            tagName: element.tagName,
            className: (element as HTMLElement).className,
            visible: isVisible,
            enabled: isEnabled,
            id: (element as HTMLElement).id
        });
        
        // Must be EXACTLY "Listings" (case insensitive) - not just containing it
        if (text?.toLowerCase().trim() === 'listings') {
            if (isVisible && isEnabled) {
                console.log('🎯 FOUND EXACT LISTINGS TAB:', text);
                (element as HTMLElement).click();
                console.log('✅ Clicked Listings tab');
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for tab switch
                return;
            }
        }
    }
    
    // Strategy 2: Look for exact "Listings" text in clickable elements
    console.log('🔍 Strategy 2: Searching all clickable elements for exact "Listings" text...');
    const allClickableElements = Array.from(document.querySelectorAll('button, a, [role="button"], [role="tab"], [tabindex], [onclick], [class*="tab"]')).filter(el => {
        const text = el.textContent?.trim().toLowerCase();
        const isVisible = (el as HTMLElement).offsetParent !== null;
        const isEnabled = !(el as HTMLButtonElement).disabled;
        return text === 'listings' && isVisible && isEnabled;
    });
    
    console.log('🔍 Found', allClickableElements.length, 'clickable elements with exact "listings" text');
    
    for (const element of allClickableElements) {
        console.log('🎯 FOUND EXACT LISTINGS ELEMENT:', {
            text: element.textContent?.trim(),
            tagName: element.tagName,
            className: (element as HTMLElement).className
        });
        (element as HTMLElement).click();
        console.log('✅ Clicked Listings element');
        await new Promise(resolve => setTimeout(resolve, 2000));
        return;
    }
    
    // Strategy 2: Look for tab group containing accounts/groups/listings
    console.log('🔍 Strategy 2: Looking for tab group with accounts/groups/listings...');
    const allElements = Array.from(document.querySelectorAll('*'));
    
    for (const element of allElements) {
        const text = element.textContent?.toLowerCase() || '';
        
        // Look for elements that contain multiple tab-like words
        if (text.includes('accounts') && text.includes('groups') && text.includes('listings')) {
            console.log('🔍 Found tab group container:', {
                tagName: element.tagName,
                className: (element as HTMLElement).className,
                textContent: element.textContent?.substring(0, 200)
            });
            
            // Look for clickable "Listings" within this container
            const listingsElements = Array.from(element.querySelectorAll('button, a, [role="button"], [role="tab"]')).filter(el => {
                return el.textContent?.toLowerCase().includes('listings');
            });
            
            for (const listingsEl of listingsElements) {
                const isVisible = (listingsEl as HTMLElement).offsetParent !== null;
                const isEnabled = !(listingsEl as HTMLButtonElement).disabled;
                
                if (isVisible && isEnabled) {
                    console.log('🎯 FOUND LISTINGS IN TAB GROUP:', listingsEl.textContent?.trim());
                    (listingsEl as HTMLElement).click();
                    console.log('✅ Clicked Listings in tab group');
                    return;
                }
            }
        }
    }
    
    throw new Error('❌ Listings tab not found');
};

const customizationsStep2TableView = async (): Promise<void> => {
    console.log('📝 Customizations Step 2: Selecting Table View icon...');
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for listings to load
    
    // Strategy 1: Look for elements with 9 squares / grid icon
    const iconElements = Array.from(document.querySelectorAll([
        'button',
        'a',
        '[role="button"]',
        'div[onclick]',
        'span[onclick]',
        '[class*="icon"]',
        '[class*="grid"]',
        '[class*="table"]',
        '[class*="view"]'
    ].join(', ')));
    
    console.log('🔍 Found', iconElements.length, 'potential icon elements');
    
    for (let i = 0; i < iconElements.length; i++) {
        const element = iconElements[i];
        const text = element.textContent?.trim().toLowerCase();
        const title = element.getAttribute('title')?.toLowerCase();
        const ariaLabel = element.getAttribute('aria-label')?.toLowerCase();
        const className = (element as HTMLElement).className.toLowerCase();
        const isVisible = (element as HTMLElement).offsetParent !== null;
        const isEnabled = !(element as HTMLButtonElement).disabled;
        
        // Look for table view indicators
        const isTableView = text?.includes('table') ||
                          text?.includes('grid') ||
                          title?.includes('table') ||
                          title?.includes('grid') ||
                          ariaLabel?.includes('table') ||
                          ariaLabel?.includes('grid') ||
                          className.includes('table') ||
                          className.includes('grid');
        
        if (isTableView) {
            console.log(`🔍 Table view candidate ${i + 1}:`, {
                text: element.textContent?.trim(),
                title: title,
                ariaLabel: ariaLabel,
                className: (element as HTMLElement).className,
                visible: isVisible,
                enabled: isEnabled
            });
            
            if (isVisible && isEnabled) {
                console.log('🎯 FOUND TABLE VIEW ICON:', element.textContent?.trim() || title || ariaLabel || 'Grid Icon');
                (element as HTMLElement).click();
                console.log('✅ Clicked Table View icon');
                return;
            }
        }
    }
    
    // Strategy 2: Look for icons that might represent a 3x3 grid (9 squares)
    console.log('🔍 Strategy 2: Looking for 3x3 grid icons...');
    const allClickableElements = Array.from(document.querySelectorAll('button, a, [role="button"], div[onclick], span[onclick]'));
    
    for (const element of allClickableElements) {
        const isVisible = (element as HTMLElement).offsetParent !== null;
        const isEnabled = !(element as HTMLButtonElement).disabled;
        
        if (!isVisible || !isEnabled) continue;
        
        // Check if element contains SVG or has grid-like styling
        const hasSvg = element.querySelector('svg') !== null;
        const hasGridClass = (element as HTMLElement).className.toLowerCase().includes('grid');
        const hasTableClass = (element as HTMLElement).className.toLowerCase().includes('table');
        
        if (hasSvg || hasGridClass || hasTableClass) {
            const text = element.textContent?.trim();
            const title = element.getAttribute('title');
            const ariaLabel = element.getAttribute('aria-label');
            
            console.log('🔍 Grid/Table icon candidate:', {
                text: text,
                title: title,
                ariaLabel: ariaLabel,
                hasSvg: hasSvg,
                hasGridClass: hasGridClass,
                hasTableClass: hasTableClass,
                className: (element as HTMLElement).className
            });
            
            // If it looks like a view switcher icon, try it
            if (hasSvg && (hasGridClass || hasTableClass || !text)) {
                console.log('🎯 TRYING TABLE VIEW ICON (SVG with grid/table class)');
                (element as HTMLElement).click();
                console.log('✅ Clicked potential Table View icon');
                return;
            }
        }
    }
    
    throw new Error('❌ Table View icon not found');
};

const customizationsStep3DownloadAll = async (): Promise<void> => {
    console.log('📝 Customizations Step 3: Clicking Download Customizations for all Listings...');
    await new Promise(resolve => setTimeout(resolve, 1000)); // Shorter wait for table view to load

    // Idempotency: if a download recently initiated, skip double click
    try {
        const { lastCustomizationsDownloadTs } = await chrome.storage.local.get(['lastCustomizationsDownloadTs']);
        const now = Date.now();
        if (lastCustomizationsDownloadTs && now - lastCustomizationsDownloadTs < 8000) {
            console.log('🛡️ Skipping duplicate download click (within 8s window)');
            return;
        }
    } catch (_) {
        // ignore storage read errors
    }
    
    // Strategy 1: Look for "Download Customizations" text
    const downloadElements = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    
    console.log('🔍 Found', downloadElements.length, 'potential download elements');
    
    for (let i = 0; i < downloadElements.length; i++) {
        const element = downloadElements[i];
        const text = element.textContent?.trim().toLowerCase();
        const title = element.getAttribute('title')?.toLowerCase();
        const ariaLabel = element.getAttribute('aria-label')?.toLowerCase();
        const isVisible = (element as HTMLElement).offsetParent !== null;
        const isEnabled = !(element as HTMLButtonElement).disabled;
        
        console.log(`🔍 Download element ${i + 1}:`, {
            text: element.textContent?.trim(),
            title: title,
            ariaLabel: ariaLabel,
            visible: isVisible,
            enabled: isEnabled
        });
        
        const hasDownload = text?.includes('download') ||
                          title?.includes('download') ||
                          ariaLabel?.includes('download');
        
        const hasCustomizations = text?.includes('customizations') ||
                                text?.includes('customization') ||
                                title?.includes('customizations') ||
                                title?.includes('customization') ||
                                ariaLabel?.includes('customizations') ||
                                ariaLabel?.includes('customization');
        
        const hasListings = text?.includes('listings') ||
                          text?.includes('all') ||
                          title?.includes('listings') ||
                          title?.includes('all') ||
                          ariaLabel?.includes('listings') ||
                          ariaLabel?.includes('all');
        
        if (hasDownload && hasCustomizations) {
            if (isVisible && isEnabled) {
                console.log('🎯 FOUND DOWNLOAD CUSTOMIZATIONS BUTTON:', element.textContent?.trim());
                (element as HTMLElement).click();
                console.log('✅ Clicked Download Customizations button');
                try { await chrome.storage.local.set({ lastCustomizationsDownloadTs: Date.now() }); } catch(_) {}
                console.log('⏳ Waiting 10 seconds for download to complete...');
                await new Promise(resolve => setTimeout(resolve, 10000)); // 10 second wait
                return;
            }
        }
    }
    
    // Strategy 2: Look for any download button (fallback)
    console.log('🔍 Strategy 2: Looking for any download button...');
    for (const element of downloadElements) {
        const text = element.textContent?.trim().toLowerCase();
        const isVisible = (element as HTMLElement).offsetParent !== null;
        const isEnabled = !(element as HTMLButtonElement).disabled;
        
        if (text?.includes('download') && isVisible && isEnabled) {
            console.log('🎯 FOUND GENERIC DOWNLOAD BUTTON:', element.textContent?.trim());
            (element as HTMLElement).click();
            console.log('✅ Clicked generic download button');
            try { await chrome.storage.local.set({ lastCustomizationsDownloadTs: Date.now() }); } catch(_) {}
            console.log('⏳ Waiting 10 seconds for download to complete...');
            await new Promise(resolve => setTimeout(resolve, 10000)); // 10 second wait
            return;
        }
    }
    
    throw new Error('❌ Download Customizations button not found');
};

const customizationsStep4Complete = async (): Promise<void> => {
    console.log('🎉 Customizations Step 4: Download customizations workflow completed!');
    await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause
};

const marketResearchStep1Dropdown = async (): Promise<void> => {
    console.log('📝 Market Research Step 1: Clicking Market Research dropdown...');
    console.log('🧪 TESTING: Current URL before dropdown click:', window.location.href);
    console.log('🧪 TESTING: Document ready state before dropdown click:', document.readyState);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Strategy 1: Look for "Market Research" dropdown
    const clickableElements = Array.from(document.querySelectorAll('button, a, [role="button"], div[onclick], span[onclick], [tabindex]'));
    
    console.log('🔍 Found', clickableElements.length, 'potential clickable elements');
    
    for (let i = 0; i < clickableElements.length; i++) {
        const element = clickableElements[i];
        const text = element.textContent?.trim();
        const isVisible = (element as HTMLElement).offsetParent !== null;
        const isEnabled = !(element as HTMLButtonElement).disabled;
        
        console.log(`🔍 Element ${i + 1}:`, {
            text: text,
            tagName: element.tagName,
            className: (element as HTMLElement).className,
            visible: isVisible,
            enabled: isEnabled
        });
        
        if (text?.includes('Market Research')) {
            if (isVisible && isEnabled) {
                console.log('🎯 FOUND MARKET RESEARCH DROPDOWN:', text);
                console.log('🧪 TESTING: About to click Market Research dropdown...');
                (element as HTMLElement).click();
                console.log('✅ Clicked Market Research dropdown');
                console.log('🧪 TESTING: URL after dropdown click:', window.location.href);
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for dropdown to open
                console.log('🧪 TESTING: URL after dropdown wait:', window.location.href);
                return;
            }
        }
    }
    
    throw new Error('❌ Market Research dropdown not found');
};

const marketResearchStep2MarketDashboard = async (): Promise<void> => {
    await saveLog('📝 Market Research Step 2: Selecting Market Dashboard (first option)...');
    await saveLog('🧪 CRITICAL DEBUG: Starting Market Dashboard selection...');
    await saveLog('🧪 CRITICAL DEBUG: Current URL at start:', window.location.href);
    await saveLog('🧪 CRITICAL DEBUG: Document ready state:', document.readyState);
    await saveLog('🧪 CRITICAL DEBUG: Page title:', document.title);

    // Check if we're already on the reports page
    const currentUrl = window.location.href;
    const isAlreadyOnReportsPage = currentUrl.startsWith('https://app.pricelabs.co/reports');

    if (isAlreadyOnReportsPage) {
        await saveLog('✅ ALREADY ON REPORTS PAGE: Skipping Market Dashboard navigation');
        await saveLog('🔄 Proceeding directly to Show Dashboard step');
        return;
    }

    await saveLog('📍 NOT ON REPORTS PAGE: Need to navigate to Market Dashboard');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Strategy 1: Look for "Market Dashboard" in dropdown items
    const dropdownItems = Array.from(document.querySelectorAll([
        '[role="menuitem"]',
        '[role="option"]', 
        '.dropdown-item',
        '.menu-item',
        '[class*="dropdown"] a',
        '[class*="menu"] a',
        '[class*="dropdown"] button',
        '[class*="menu"] button',
        'li a',
        'li button'
    ].join(', ')));
    
    await saveLog('🔍 Found', dropdownItems.length + ' potential dropdown items');
    await saveLog('🧪 CRITICAL DEBUG: About to analyze dropdown items...');

    for (let i = 0; i < dropdownItems.length; i++) {
        const item = dropdownItems[i];
        const text = item.textContent?.trim();
        const isVisible = (item as HTMLElement).offsetParent !== null;
        const isEnabled = !(item as HTMLButtonElement).disabled;

        await saveLog(`🔍 Dropdown item ${i + 1}:`, {
            text: text,
            tagName: item.tagName,
            className: (item as HTMLElement).className,
            visible: isVisible,
            enabled: isEnabled
        });

        if (text?.toLowerCase().includes('market dashboard')) {
            if (isVisible && isEnabled) {
                await saveLog('🎯 FOUND MARKET DASHBOARD OPTION:', text);
                // Log details as individual lines to avoid Object display issue
                await saveLog('🧪 CRITICAL DEBUG: Market Dashboard option details:');
                await saveLog('  📝 text:', text);
                await saveLog('  🏷️ tagName:', item.tagName);
                await saveLog('  🎨 className:', (item as HTMLElement).className);
                await saveLog('  🆔 id:', (item as HTMLElement).id);
                await saveLog('  🔗 href:', (item as HTMLAnchorElement).href);
                await saveLog('  ⚡ onclick:', (item as HTMLElement).onclick?.toString());
                await saveLog('  📄 innerHTML:', item.innerHTML.substring(0, 200));
                await saveLog('  👀 outerHTML:', (item as HTMLElement).outerHTML.substring(0, 300));

                await saveLog('🔧 SOLUTION: This is a direct link causing page reload. Using controlled navigation instead.');
                await saveLog('🔧 SOLUTION: Will prevent default click and use window.location for smoother navigation.');
                
                // Instead of clicking the link (which causes page reload), use controlled navigation
                const targetUrl = (item as HTMLAnchorElement).href;
                await saveLog('🔧 SOLUTION: Navigating to:', targetUrl);

                // PRE-CLICK VALIDATION: Record current URL to detect navigation
                const preNavUrl = window.location.href;
                await saveLog('🔍 PRE-NAVIGATION URL:', preNavUrl);

                // Prevent navigation to the same URL
                if (preNavUrl === targetUrl) {
                    await saveLog('⚠️ SAME URL DETECTED: Already on target page, skipping navigation');
                    await saveLog('🔄 Continuing workflow without navigation');
                    return;
                }

                // Use window.location.href for controlled navigation
                window.location.href = targetUrl;

                await saveLog('✅ Initiated controlled navigation to Market Dashboard');

                // POST-NAVIGATION VALIDATION: Check if navigation occurred (though this might not execute due to navigation)
                await new Promise(resolve => setTimeout(resolve, 1000)); // Brief wait for navigation to start
                const postNavUrl = window.location.href;
                await saveLog('🔍 POST-NAVIGATION URL:', postNavUrl);

                if (preNavUrl !== postNavUrl) {
                    await saveLog('🚨 NAVIGATION DETECTED: Market Dashboard navigation successful');
                    await saveLog('⏳ Waiting for navigation to complete...');
                    // Wait longer for the navigation to fully complete
                    await new Promise(resolve => setTimeout(resolve, 4000));
                    await saveLog('✅ Navigation completed, continuing workflow');
                } else {
                    await saveLog('⚠️ NO NAVIGATION DETECTED: URL remained the same');
                }
                return;
            }
        }
    }
    
    // If Market Dashboard not found, log all dropdown items for debugging
    await saveLog('🛑 CRITICAL DEBUG: Market Dashboard not found. Logging ALL dropdown items:');
    for (let i = 0; i < dropdownItems.length; i++) {
        const item = dropdownItems[i];
        const text = item.textContent?.trim();
        await saveLog(`🔍 Dropdown item ${i + 1}:`, {
            text: text,
            tagName: item.tagName,
            className: (item as HTMLElement).className,
            id: (item as HTMLElement).id,
            href: (item as HTMLAnchorElement).href,
            visible: (item as HTMLElement).offsetParent !== null,
            enabled: !(item as HTMLButtonElement).disabled,
            innerHTML: item.innerHTML.substring(0, 100)
        });
    }
    
    throw new Error('🛑 CRITICAL PAUSE: No Market Dashboard option found. Check console for all dropdown items.');
};

const marketResearchStep3Complete = async (): Promise<void> => {
    await saveLog('🎉 Market Research Step 3: Navigation to Market Dashboard completed!');

    // Check if we're on the reports page
    const url = window.location.href;
    const title = document.title;

    await saveLog('🔍 Current page details:', {
        url: url,
        title: title,
        readyState: document.readyState
    });

    // Check if we're already on the correct dashboard page
    const isAlreadyOnDashboard = url.includes('/reports/') &&
        url.includes('compSet=') &&
        url.includes('t=full_dashboard');

    if (isAlreadyOnDashboard) {
        await saveLog('✅ ALREADY ON DASHBOARD PAGE: Dashboard is already active');
        await saveLog('🔄 Skipping Show Dashboard step - proceeding to PDF download');
        return;
    }

    // Wait for page to be fully interactive
    if (document.readyState !== 'complete') {
        await saveLog('🔄 Waiting for page to complete loading...');
        await new Promise(resolve => {
            const checkReady = () => {
                if (document.readyState === 'complete') {
                    saveLog('✅ Page is now complete');
                    resolve(undefined);
                } else {
                    setTimeout(checkReady, 500);
                }
            };
            checkReady();
        });
    }

    // Additional wait for React components to settle
    await saveLog('🔄 Waiting for React components to settle...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    await saveLog('✅ Market Research page is ready for interaction');
    await saveLog('📍 Will proceed to Show Dashboard step next');
};

// Persistent logging function that survives page refreshes
const saveLog = async (message: string, data?: any) => {
    try {
        const logEntry = {
            timestamp: new Date().toISOString(),
            message,
            data,
            url: window.location.href
        };

        // Get existing logs
        const result = await chrome.storage.local.get(['workflowLogs']);
        const existingLogs = result.workflowLogs || [];

        // Add new log entry
        existingLogs.push(logEntry);

        // Keep only last 100 entries to avoid storage bloat
        const recentLogs = existingLogs.slice(-100);

        // Save to storage
        await chrome.storage.local.set({ workflowLogs: recentLogs });

        // Also log to console
        console.log(message, data);
    } catch (error) {
        console.error('Failed to save log:', error);
        console.log(message, data); // Fallback to console only
    }
};

const marketResearchStep4ShowDashboard = async (): Promise<void> => {
    await saveLog('📝 Market Research Step 4: Clicking Show Dashboard button...');
    await saveLog('🔍 DETAILED DEBUG: Function started at', new Date().toISOString());

    try {
        await new Promise(resolve => setTimeout(resolve, 3000)); // Longer wait for page to fully load
        await saveLog('🔍 DETAILED DEBUG: Initial wait completed');

        // Check if we're on a login page
        const currentUrl = window.location.href;
        const pageTitle = document.title;
        const bodyText = document.body.innerText.toLowerCase();

        await saveLog('🔍 ENHANCED DEBUG: Starting comprehensive Show Dashboard button search...');
        await saveLog('🔍 Current URL:', currentUrl);
        await saveLog('🔍 Page title:', pageTitle);
        await saveLog('🔍 Document ready state:', document.readyState);
        await saveLog('🔍 Body text preview (first 200 chars):', bodyText.substring(0, 200));

        // FIRST: Check if we're already on the dashboard page
        const isAlreadyOnDashboard = currentUrl.includes('/reports/') &&
            currentUrl.includes('compSet=') &&
            currentUrl.includes('t=full_dashboard');

        if (isAlreadyOnDashboard) {
            await saveLog('✅ DASHBOARD ALREADY ACTIVE: Already on dashboard page');
            await saveLog('🔄 Skipping Show Dashboard button click - proceeding to PDF download');
            await saveLog('⏳ Waiting 3 seconds for dashboard to be fully ready...');
            await new Promise(resolve => setTimeout(resolve, 3000));
            return;
        }

        await saveLog('📍 NOT ON DASHBOARD PAGE: Need to click Show Dashboard button');
    
    // Detect login page
    if (currentUrl.includes('/login') || 
        bodyText.includes('please enter your email') || 
        bodyText.includes('login') || 
        document.querySelector('input[type="password"]') ||
        pageTitle.toLowerCase().includes('login')) {
        console.log('❌ LOGIN PAGE DETECTED! User needs to log in first.');
        console.log('🔍 Body text preview:', bodyText.substring(0, 200));
        throw new Error('❌ Login required. Please log in to PriceLabs and try again.');
    }
    
    // Check if we're not on the reports page
    if (!currentUrl.includes('/reports')) {
        console.log('❌ NOT ON REPORTS PAGE. Current URL:', currentUrl);
        throw new Error('❌ Not on reports page. Please navigate to Market Dashboard first.');
    }
    
    // Strategy 1: Look for "Show Dashboard" button with enhanced search
    // Look for Show Dashboard button
    const allClickableElements = Array.from(document.querySelectorAll([
        'button',
        'a',
        '[role="button"]', 
        'div[onclick]',
        'span[onclick]',
        '[tabindex]',
        'input[type="button"]',
        'input[type="submit"]',
        '[class*="button"]',
        '[class*="btn"]'
    ].join(', ')));
    
    await saveLog('🔍 Found', allClickableElements.length + ' total clickable elements');

    // Strategy 1: Exact "Show Dashboard" match
    await saveLog('🔍 Strategy 1: Looking for exact "Show Dashboard" text...');
    for (const element of allClickableElements) {
        const textRaw = element.textContent?.trim() || '';
        const text = textRaw.toLowerCase();
        const title = element.getAttribute('title')?.toLowerCase();
        const ariaLabel = element.getAttribute('aria-label')?.toLowerCase();
        const isVisible = (element as HTMLElement).offsetParent !== null;
        const isEnabled = !(element as HTMLButtonElement).disabled;
        const href = (element as HTMLAnchorElement).href || '';
        const role = (element as HTMLElement).getAttribute('role') || '';

        // Guard: skip elements that could cause refresh/login/navigation
        const isDangerous =
            href.includes('/reports') ||
            href.includes('/login') ||
            text.includes('refresh') ||
            text.includes('click to refresh') ||
            text.includes('login') ||
            title?.includes('refresh') ||
            ariaLabel?.includes('refresh');
        if (isDangerous) {
            await saveLog('⚠️ Skipping potentially dangerous element:', { text: textRaw, href, title, ariaLabel, role });
            continue;
        }

        if ((text.includes('show') && text.includes('dashboard')) ||
            (title?.includes('show') && title?.includes('dashboard')) ||
            (ariaLabel?.includes('show') && ariaLabel?.includes('dashboard'))) {
            if (isVisible && isEnabled) {
                await saveLog('🎯 FOUND SHOW DASHBOARD BUTTON (Strategy 1):', {
                    text: textRaw,
                    title,
                    ariaLabel,
                    href,
                    tagName: element.tagName,
                    className: (element as HTMLElement).className,
                    id: (element as HTMLElement).id,
                    role: role,
                    onclick: element.getAttribute('onclick'),
                    dataset: (element as HTMLElement).dataset
                });

                // Additional guard: Check if element has any data attributes that might cause navigation
                const dataset = (element as HTMLElement).dataset;
                const hasNavigationAttrs = Object.keys(dataset).some(key =>
                    dataset[key]?.toLowerCase().includes('reports') ||
                    dataset[key]?.toLowerCase().includes('navigate') ||
                    dataset[key]?.toLowerCase().includes('redirect')
                );

                if (hasNavigationAttrs) {
                    console.log('⚠️ SKIPPING ELEMENT WITH NAVIGATION DATA ATTRIBUTES:', Object.keys(dataset));
                    continue;
                }

                // Check for event listeners that might cause navigation
                const hasNavigationListeners = element.outerHTML.toLowerCase().includes('location.href') ||
                    element.outerHTML.toLowerCase().includes('window.location') ||
                    element.outerHTML.toLowerCase().includes('/reports');

                if (hasNavigationListeners) {
                    console.log('⚠️ SKIPPING ELEMENT WITH NAVIGATION EVENT LISTENERS');
                    continue;
                }

                // PRE-CLICK VALIDATION: Record current URL to detect navigation
                const preClickUrl = window.location.href;
                await saveLog('🔍 PRE-CLICK URL:', preClickUrl);

                (element as HTMLElement).click();
                await saveLog('✅ Clicked Show Dashboard button');

                // POST-CLICK VALIDATION: Check if navigation occurred
                await new Promise(resolve => setTimeout(resolve, 1000)); // Short wait for navigation to start
                const postClickUrl = window.location.href;
                await saveLog('🔍 POST-CLICK URL:', postClickUrl);

                if (preClickUrl !== postClickUrl) {
                    await saveLog('🚨 NAVIGATION DETECTED! Element caused URL change');
                    await saveLog('🚨 From:', preClickUrl);
                    await saveLog('🚨 To:', postClickUrl);

                    // Check if this is the expected navigation to a specific reports page
                    const isExpectedNavigation = preClickUrl === 'https://app.pricelabs.co/reports' &&
                        postClickUrl.startsWith('https://app.pricelabs.co/reports/') &&
                        postClickUrl.includes('compSet=') &&
                        postClickUrl.includes('t=full_dashboard');

                    if (isExpectedNavigation) {
                        await saveLog('✅ EXPECTED NAVIGATION: Show Dashboard button correctly navigated to specific reports page');
                        await saveLog('⏳ Waiting for navigation to complete...');
                        // Wait longer for the specific reports page to fully load
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        await saveLog('✅ Navigation completed, continuing workflow');
                        return;
                    } else {
                        // If we navigated somewhere unexpected, this is the wrong element
                        throw new Error(`Show Dashboard click caused unexpected navigation from ${preClickUrl} to ${postClickUrl}`);
                    }
                }

                await saveLog('✅ No navigation detected - Show Dashboard click successful');
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for dashboard to load
                return;
            }
        }
    }

    // Strategy 2: Look for "Dashboard" only (with guards)
    await saveLog('🔍 Strategy 2: Looking for buttons containing "Dashboard"...');
    for (const element of allClickableElements) {
        const textRaw = element.textContent?.trim() || '';
        const text = textRaw.toLowerCase();
        const title = element.getAttribute('title')?.toLowerCase();
        const ariaLabel = element.getAttribute('aria-label')?.toLowerCase();
        const isVisible = (element as HTMLElement).offsetParent !== null;
        const isEnabled = !(element as HTMLButtonElement).disabled;
        const href = (element as HTMLAnchorElement).href || '';
        const role = (element as HTMLElement).getAttribute('role') || '';

        const isDangerous =
            href.includes('/reports') ||
            href.includes('/login') ||
            text.includes('refresh') ||
            text.includes('click to refresh') ||
            text.includes('login') ||
            title?.includes('refresh') ||
            ariaLabel?.includes('refresh');
        if (isDangerous) {
            await saveLog('⚠️ Skipping potentially dangerous element:', { text: textRaw, href, title, ariaLabel, role });
            continue;
        }

        if (text.includes('dashboard') || title?.includes('dashboard') || ariaLabel?.includes('dashboard')) {
            if (isVisible && isEnabled) {
                // Additional guard: Skip "go back" buttons that would navigate away from dashboard
                const isGoBackButton = textRaw.toLowerCase().includes('go back') ||
                    textRaw.toLowerCase().includes('back to') ||
                    ariaLabel?.toLowerCase().includes('go back') ||
                    ariaLabel?.toLowerCase().includes('back to') ||
                    (element as HTMLElement).id?.includes('go-back');

                if (isGoBackButton) {
                    await saveLog('⚠️ SKIPPING GO BACK BUTTON: This would navigate away from dashboard');
                    continue;
                }

                await saveLog('🎯 FOUND DASHBOARD BUTTON (Strategy 2):', {
                    text: textRaw,
                    title,
                    ariaLabel,
                    href,
                    tagName: element.tagName,
                    className: (element as HTMLElement).className,
                    id: (element as HTMLElement).id,
                    role: role,
                    onclick: element.getAttribute('onclick'),
                    dataset: (element as HTMLElement).dataset
                });

                // Additional guard: Check if element has any data attributes that might cause navigation
                const dataset = (element as HTMLElement).dataset;
                const hasNavigationAttrs = Object.keys(dataset).some(key =>
                    dataset[key]?.toLowerCase().includes('reports') ||
                    dataset[key]?.toLowerCase().includes('navigate') ||
                    dataset[key]?.toLowerCase().includes('redirect')
                );

                if (hasNavigationAttrs) {
                    console.log('⚠️ SKIPPING ELEMENT WITH NAVIGATION DATA ATTRIBUTES:', Object.keys(dataset));
                    continue;
                }

                // Check for event listeners that might cause navigation
                const hasNavigationListeners = element.outerHTML.toLowerCase().includes('location.href') ||
                    element.outerHTML.toLowerCase().includes('window.location') ||
                    element.outerHTML.toLowerCase().includes('/reports');

                if (hasNavigationListeners) {
                    console.log('⚠️ SKIPPING ELEMENT WITH NAVIGATION EVENT LISTENERS');
                    continue;
                }

                // PRE-CLICK VALIDATION: Record current URL to detect navigation
                const preClickUrl = window.location.href;
                await saveLog('🔍 PRE-CLICK URL:', preClickUrl);

                (element as HTMLElement).click();
                await saveLog('✅ Clicked Dashboard button');

                // POST-CLICK VALIDATION: Check if navigation occurred
                await new Promise(resolve => setTimeout(resolve, 1000)); // Short wait for navigation to start
                const postClickUrl = window.location.href;
                await saveLog('🔍 POST-CLICK URL:', postClickUrl);

                if (preClickUrl !== postClickUrl) {
                    await saveLog('🚨 NAVIGATION DETECTED! Element caused URL change');
                    await saveLog('🚨 From:', preClickUrl);
                    await saveLog('🚨 To:', postClickUrl);

                    // Check if this is the expected navigation to a specific reports page
                    const isExpectedNavigation = preClickUrl === 'https://app.pricelabs.co/reports' &&
                        postClickUrl.startsWith('https://app.pricelabs.co/reports/') &&
                        postClickUrl.includes('compSet=') &&
                        postClickUrl.includes('t=full_dashboard');

                    if (isExpectedNavigation) {
                        await saveLog('✅ EXPECTED NAVIGATION: Dashboard button correctly navigated to specific reports page');
                        await saveLog('⏳ Waiting for navigation to complete...');
                        // Wait longer for the specific reports page to fully load
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        await saveLog('✅ Navigation completed, continuing workflow');
                        return;
                    } else {
                        // If we navigated somewhere unexpected, this is the wrong element
                        throw new Error(`Dashboard click caused unexpected navigation from ${preClickUrl} to ${postClickUrl}`);
                    }
                }

                await saveLog('✅ No navigation detected - Dashboard click successful');
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for dashboard to load
                return;
            }
        }
    }

    // Strategy 3: Removed risky right-side fallback to avoid mis-clicking refresh/reload elements
    console.log('🛡️ Skipping risky right-side fallback to prevent accidental refresh/reloads');

    // Strategy 4: Look for any button with "show" in the text (with guards)
    console.log('🔍 Strategy 4: Looking for buttons containing "Show"...');
    for (const element of allClickableElements) {
        const textRaw = element.textContent?.trim() || '';
        const text = textRaw.toLowerCase();
        const isVisible = (element as HTMLElement).offsetParent !== null;
        const isEnabled = !(element as HTMLButtonElement).disabled;
        const href = (element as HTMLAnchorElement).href || '';

        const isDangerous =
            href.includes('/reports') ||
            href.includes('/login') ||
            text.includes('refresh') ||
            text.includes('click to refresh') ||
            text.includes('login');
        if (isDangerous) {
            console.log('⚠️ Skipping potentially dangerous element:', { text: textRaw, href });
            continue;
        }
        
        if (text.includes('show') && isVisible && isEnabled) {
            console.log('🎯 FOUND SHOW BUTTON (Strategy 4):', textRaw);
            (element as HTMLElement).click();
            console.log('✅ Clicked Show button');
            await new Promise(resolve => setTimeout(resolve, 3000));
            return;
        }
    }
    
        console.log('❌ No Show Dashboard button found with any strategy');
        console.log('🔍 Page HTML preview (first 1000 chars):', document.body.innerHTML.substring(0, 1000));
        console.log('🔍 DETAILED DEBUG: Function ending with error at', new Date().toISOString());
        throw new Error('❌ Show Dashboard button not found');
        
    } catch (error) {
        console.error('🚨 ERROR in marketResearchStep4ShowDashboard:', error);
        console.log('🔍 DETAILED DEBUG: Exception caught at', new Date().toISOString());
        console.log('🔍 Error details:', {
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : 'No stack trace',
            currentUrl: window.location.href,
            documentReady: document.readyState
        });
        throw error; // Re-throw to propagate to background script
    }
};

const marketResearchStep5Complete = async (): Promise<void> => {
    await saveLog('🎉 Market Research Step 5: Show Dashboard workflow completed!');
    await saveLog('⏳ Waiting 12 seconds before downloading PDF...');
    await new Promise(resolve => setTimeout(resolve, 12000)); // 12 second wait
    await saveLog('✅ 12-second wait completed, proceeding to PDF download');
};

const marketResearchStep6DownloadPDF = async (): Promise<void> => {
    await saveLog('📝 Market Research Step 6: Clicking Download as PDF button...');
    await saveLog('🔍 Current URL:', window.location.href);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Strategy 1: PRIORITIZE top-right PDF buttons (most likely location)
    await saveLog('🔍 Strategy 1: Looking for PDF buttons positioned on the top right...');
    const topRightElements = Array.from(document.querySelectorAll('button, a, [role="button"], div[onclick], span[onclick]')).filter(el => {
        const rect = el.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        // Consider "top right" as elements in the right 30% and top 30% of the screen
        return rect.left > windowWidth * 0.7 && rect.top < windowHeight * 0.3 && (el as HTMLElement).offsetParent !== null;
    });

    await saveLog('🔍 Found', topRightElements.length + ' elements on the top right');
    
    for (const element of topRightElements) {
        const text = element.textContent?.trim().toLowerCase();
        const title = element.getAttribute('title')?.toLowerCase();
        const ariaLabel = element.getAttribute('aria-label')?.toLowerCase();
        const isEnabled = !(element as HTMLButtonElement).disabled;
        
        await saveLog('🔍 Top-right element:', {
            text: element.textContent?.trim(),
            title: title,
            ariaLabel: ariaLabel,
            tagName: element.tagName,
            className: (element as HTMLElement).className,
            enabled: isEnabled
        });

        const hasPDF = text?.includes('pdf') || title?.includes('pdf') || ariaLabel?.includes('pdf');
        const hasDownload = text?.includes('download') || title?.includes('download') || ariaLabel?.includes('download');

        if ((hasPDF && hasDownload) || (hasPDF && (text?.includes('export') || title?.includes('export')))) {
            if (isEnabled) {
                await saveLog('🎯 FOUND TOP-RIGHT PDF BUTTON:', element.textContent?.trim());
                (element as HTMLElement).click();
                await saveLog('✅ Clicked top-right PDF button');
                await saveLog('⏳ Waiting 25 seconds for PDF download...');
                await new Promise(resolve => setTimeout(resolve, 25000)); // Increased to 25 seconds
                await saveLog('✅ PDF download wait completed');
                return;
            }
        }
    }
    
    // Strategy 2: Fallback to any PDF download button anywhere on page
    await saveLog('🔍 Strategy 2: Looking for any PDF download button on the page...');
    const buttonElements = Array.from(document.querySelectorAll('button, a, [role="button"], div[onclick], span[onclick]'));

    await saveLog('🔍 Found', buttonElements.length + ' potential button elements');
    
    for (let i = 0; i < buttonElements.length; i++) {
        const element = buttonElements[i];
        const text = element.textContent?.trim().toLowerCase();
        const title = element.getAttribute('title')?.toLowerCase();
        const ariaLabel = element.getAttribute('aria-label')?.toLowerCase();
        const isVisible = (element as HTMLElement).offsetParent !== null;
        const isEnabled = !(element as HTMLButtonElement).disabled;
        
        await saveLog(`🔍 Button element ${i + 1}:`, {
            text: element.textContent?.trim(),
            title: title,
            ariaLabel: ariaLabel,
            tagName: element.tagName,
            className: (element as HTMLElement).className,
            visible: isVisible,
            enabled: isEnabled
        });

        const hasPDF = text?.includes('pdf') || title?.includes('pdf') || ariaLabel?.includes('pdf');
        const hasDownload = text?.includes('download') || title?.includes('download') || ariaLabel?.includes('download');

        if (hasPDF && hasDownload) {
            if (isVisible && isEnabled) {
                await saveLog('🎯 FOUND DOWNLOAD PDF BUTTON (Fallback):', element.textContent?.trim());
                (element as HTMLElement).click();
                await saveLog('✅ Clicked Download PDF button');
                await saveLog('⏳ Waiting 25 seconds for PDF download...');
                await new Promise(resolve => setTimeout(resolve, 25000)); // Increased to 25 seconds
                await saveLog('✅ PDF download wait completed');
                return;
            }
        }
    }
    
    // Strategy 3: Look for any button with PDF in the text (fallback)
    await saveLog('🔍 Strategy 3: Looking for any button containing "PDF"...');
    let pdfButtonsFound = 0;
    for (const element of buttonElements) {
        const text = element.textContent?.trim().toLowerCase();
        const isVisible = (element as HTMLElement).offsetParent !== null;
        const isEnabled = !(element as HTMLButtonElement).disabled;

        if (text?.includes('pdf')) {
            pdfButtonsFound++;
            await saveLog(`🔍 PDF button ${pdfButtonsFound}:`, {
                text: element.textContent?.trim(),
                tagName: element.tagName,
                visible: isVisible,
                enabled: isEnabled
            });

            if (isVisible && isEnabled) {
                await saveLog('🎯 FOUND GENERIC PDF BUTTON:', element.textContent?.trim());
                (element as HTMLElement).click();
                await saveLog('✅ Clicked generic PDF button');
                await saveLog('⏳ Waiting 25 seconds for PDF download...');
                await new Promise(resolve => setTimeout(resolve, 25000)); // Increased to 25 seconds
                await saveLog('✅ PDF download wait completed');
                return;
            }
        }
    }

    await saveLog('❌ CRITICAL: No PDF download button found after all strategies');
    await saveLog('📊 Summary:', {
        totalButtons: buttonElements.length,
        pdfButtonsFound: pdfButtonsFound,
        currentUrl: window.location.href
    });

    throw new Error('❌ Download as PDF button not found - Check persistent logs for details');
};

const marketResearchStep7Complete = async (): Promise<void> => {
    await saveLog('🎉 Market Research Step 7: PDF download workflow completed!');
    await saveLog('✅ Full workflow completed successfully!');
    await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause
};

// AIRBNB PRICE TIPS EXTRACTION FUNCTIONS

const scrollCalendarToLoadAllMonths = async (): Promise<void> => {
  // Logic now handled in background.ts
  await saveLog('Zoom and fullscreen now handled in background script.');
};

const extractPriceTipsData = async (): Promise<Array<{
    date: string;
    currentPrice: number | null;
    suggestedPrice: number | null;
    dayOfWeek: string;
    month: string;
    year: string;
}>> => {
    await saveLog('🔍 AIRBNB: Starting comprehensive price tips extraction...');

    const priceTipsData: Array<{
        date: string;
        currentPrice: number | null;
        suggestedPrice: number | null;
        dayOfWeek: string;
        month: string;
        year: string;
    }> = [];

    try {
        // STEP 1: Scroll through calendar to load all months
        await saveLog('📜 AIRBNB: Scrolling through calendar to load all months...');
        await scrollCalendarToLoadAllMonths();

        // STEP 2: Look for calendar day elements that contain pricing information
        const calendarDays = Array.from(document.querySelectorAll([
            '[data-testid*="calendar-day"]',
            '[data-testid*="day"]',
            '.calendar-day',
            '.day',
            '[class*="calendar"] [class*="day"]',
            '[role="gridcell"]',
            '[aria-label*="calendar"]',
            // Generic selectors for calendar elements
            'div[aria-label*="calendar"]',
            'button[aria-label*="calendar"]',
            'div[aria-label*="date"]',
            'button[aria-label*="date"]'
        ].join(', ')));

        await saveLog(`📅 Found ${calendarDays.length} potential calendar day elements`);

        // Debug: Log content of first few calendar elements
        for (let i = 0; i < Math.min(5, calendarDays.length); i++) {
            const element = calendarDays[i];
            await saveLog(`🔍 Calendar Element ${i}: ${element.textContent?.substring(0, 200)}`);
            await saveLog(`🔍 Element attributes: ${Array.from(element.attributes).map(attr => `${attr.name}=${attr.value}`).join(', ')}`);
        }

        for (const dayElement of calendarDays) {
            try {
                const dayData = await extractSingleDayPriceData(dayElement);
                if (dayData && (dayData.currentPrice || dayData.suggestedPrice)) {
                    priceTipsData.push(dayData);
                    await saveLog(`📊 Extracted: ${dayData.date} - Current: $${dayData.currentPrice}, Suggested: $${dayData.suggestedPrice}`);
                }
            } catch (dayError) {
                // Skip problematic days but continue with others
                console.log('⚠️ Skipped problematic calendar day:', dayError.message);
            }
        }

        // Alternative: Look for price tip overlays or tooltips (using only valid CSS selectors)
        const priceTipElements = Array.from(document.querySelectorAll([
            '[data-testid*="price-tip"]',
            '[data-testid*="price_tip"]',
            '[class*="price-tip"]',
            '[class*="price_tip"]',
            '[aria-label*="price"]',
            'div[class*="tooltip"]',
            'div[class*="overlay"]',
            '[role="tooltip"]',
            '[role="dialog"]',
            '.tooltip',
            '.overlay'
        ].join(', ')));

        await saveLog(`💡 Found ${priceTipElements.length} price tip elements`);

        // Debug: Log content of first few price tip elements
        for (let i = 0; i < Math.min(5, priceTipElements.length); i++) {
            const element = priceTipElements[i];
            await saveLog(`🔍 Price Tip Element ${i}: ${element.textContent?.substring(0, 200)}`);
            await saveLog(`🔍 Price Tip attributes: ${Array.from(element.attributes).map(attr => `${attr.name}=${attr.value}`).join(', ')}`);
        }

        for (const tipElement of priceTipElements) {
            try {
                const tipData = await extractPriceTipOverlayData(tipElement);
                if (tipData && !priceTipsData.find(d => d.date === tipData.date)) {
                    priceTipsData.push(tipData);
                    await saveLog(`📊 Overlay: ${tipData.date} - Current: $${tipData.currentPrice}, Suggested: $${tipData.suggestedPrice}`);
                }
            } catch (tipError) {
                console.log('⚠️ Skipped problematic price tip:', tipError.message);
            }
        }

    } catch (error) {
        await saveLog(`❌ Error extracting price tips: ${error.message}`);

        // Fallback: Try simpler price extraction
        await saveLog('🔄 Attempting fallback price extraction...');

        try {
            const allTextElements = Array.from(document.querySelectorAll('*')).filter(el => {
                const text = el.textContent || '';
                return text.includes('$') && text.match(/\$\d+/);
            });

            await saveLog(`💡 Fallback found ${allTextElements.length} elements with price data`);

            for (const element of allTextElements.slice(0, 20)) { // Limit to first 20
                const text = element.textContent || '';
                await saveLog(`📊 Price element: ${text.substring(0, 100)}`);
            }

            // If we found any price data, create a basic CSV
            if (allTextElements.length > 0) {
                const fallbackData = [{
                    date: new Date().toISOString().split('T')[0],
                    currentPrice: null,
                    suggestedPrice: null,
                    dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
                    month: new Date().toLocaleDateString('en-US', { month: 'long' }),
                    year: new Date().getFullYear().toString()
                }];

                await saveLog('✅ Fallback extraction completed');
                return fallbackData;
            }

        } catch (fallbackError) {
            await saveLog(`❌ Fallback extraction also failed: ${fallbackError.message}`);
        }

        throw error;
    }

    await saveLog(`✅ Completed extraction: ${priceTipsData.length} entries found`);
    return priceTipsData;
};

const extractSingleDayPriceData = async (dayElement: Element): Promise<{
    date: string;
    currentPrice: number | null;
    suggestedPrice: number | null;
    dayOfWeek: string;
    month: string;
    year: string;
} | null> => {
    // Extract date information
    const dateText = dayElement.getAttribute('aria-label') ||
                    dayElement.getAttribute('data-date') ||
                    dayElement.getAttribute('data-testid') ||
                    dayElement.textContent?.split('\n')[0] ||
                    '';

    // Extract prices from the element and all its children
    const allText = [
        dayElement.textContent || '',
        ...Array.from(dayElement.querySelectorAll('*')).map(el => el.textContent || '')
    ].join(' ');

    const priceMatches = allText.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g);

    let currentPrice: number | null = null;
    let suggestedPrice: number | null = null;

    if (priceMatches && priceMatches.length >= 1) {
        // First price is typically current price
        currentPrice = parseFloat(priceMatches[0].replace(/[$,]/g, ''));

        // Second price is typically suggested price
        if (priceMatches.length >= 2) {
            suggestedPrice = parseFloat(priceMatches[1].replace(/[$,]/g, ''));
        }
    }

    // Also look for prices without dollar signs (sometimes Airbnb shows just numbers)
    const numberMatches = allText.match(/\b(\d+(?:,\d{3})*(?:\.\d{2})?)\b/g);
    if (!priceMatches && numberMatches && numberMatches.length >= 1) {
        currentPrice = parseFloat(numberMatches[0].replace(/,/g, ''));
        if (numberMatches.length >= 2) {
            suggestedPrice = parseFloat(numberMatches[1].replace(/,/g, ''));
        }
    }

    // Extract date components
    const date = new Date(dateText);
    const isValidDate = !isNaN(date.getTime());

    if (isValidDate) {
        return {
            date: date.toISOString().split('T')[0],
            currentPrice,
            suggestedPrice,
            dayOfWeek: date.toLocaleDateString('en-US', { weekday: 'long' }),
            month: date.toLocaleDateString('en-US', { month: 'long' }),
            year: date.getFullYear().toString()
        };
    }

    return null;
};

const extractPriceTipOverlayData = async (tipElement: Element): Promise<{
    date: string;
    currentPrice: number | null;
    suggestedPrice: number | null;
    dayOfWeek: string;
    month: string;
    year: string;
} | null> => {
    // Extract data from price tip overlays/tooltips with comprehensive search

    // Look for price data in the element and all its children
    const allText = [
        tipElement.textContent || '',
        ...Array.from(tipElement.querySelectorAll('*')).map(el => el.textContent || '')
    ].join(' ');

    const priceMatches = allText.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g);

    let currentPrice: number | null = null;
    let suggestedPrice: number | null = null;

    if (priceMatches && priceMatches.length >= 1) {
        currentPrice = parseFloat(priceMatches[0].replace(/[$,]/g, ''));
        if (priceMatches.length >= 2) {
            suggestedPrice = parseFloat(priceMatches[1].replace(/[$,]/g, ''));
        }
    }

    // Also look for prices without dollar signs
    const numberMatches = allText.match(/\b(\d+(?:,\d{3})*(?:\.\d{2})?)\b/g);
    if (!priceMatches && numberMatches && numberMatches.length >= 1) {
        currentPrice = parseFloat(numberMatches[0].replace(/,/g, ''));
        if (numberMatches.length >= 2) {
            suggestedPrice = parseFloat(numberMatches[1].replace(/,/g, ''));
        }
    }

    if (!currentPrice && !suggestedPrice) {
        return null; // No price data found
    }

    // Find associated date element with more comprehensive search
    const dateElement = tipElement.closest('[data-date]') ||
                       tipElement.closest('[aria-label*="date"]') ||
                       tipElement.closest('[data-testid*="day"]') ||
                       tipElement.closest('[class*="date"]') ||
                       tipElement.closest('[aria-label*="calendar"]');

    let dateText = dateElement?.getAttribute('data-date') ||
                   dateElement?.getAttribute('aria-label') ||
                   dateElement?.textContent?.split('\n')[0] ||
                   '';

    // If no date found, try to extract from the overlay itself
    if (!dateText) {
        const dateMatch = allText.match(/(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|\w+ \d{1,2},? \d{4})/);
        if (dateMatch) {
            dateText = dateMatch[0];
        }
    }

    if (!dateText) {
        // Fallback: use current date if no date found
        const now = new Date();
        dateText = now.toISOString().split('T')[0];
    }

    const date = new Date(dateText);
    const isValidDate = !isNaN(date.getTime());

    return {
        date: isValidDate ? date.toISOString().split('T')[0] : dateText,
        currentPrice,
        suggestedPrice,
        dayOfWeek: isValidDate ? date.toLocaleDateString('en-US', { weekday: 'long' }) : '',
        month: isValidDate ? date.toLocaleDateString('en-US', { month: 'long' }) : '',
        year: isValidDate ? date.getFullYear().toString() : ''
    };
};

const generatePriceTipsCSV = async (priceData: Array<{
    date: string;
    currentPrice: number | null;
    suggestedPrice: number | null;
    dayOfWeek: string;
    month: string;
    year: string;
}>): Promise<string> => {
    await saveLog('📄 Generating CSV content from price data...');

    const headers = ['Date', 'Day of Week', 'Month', 'Year', 'Current Price', 'Suggested Price'];

    const csvRows = [
        headers.join(','),
        ...priceData.map(row => {
            return [
                row.date,
                row.dayOfWeek,
                row.month,
                row.year,
                row.currentPrice ? `$${row.currentPrice}` : '',
                row.suggestedPrice ? `$${row.suggestedPrice}` : ''
            ].join(',');
        })
    ];

    await saveLog(`✅ Generated CSV with ${priceData.length} data rows`);
    return csvRows.join('\n');
};

const downloadCSV = async (csvContent: string): Promise<void> => {
    await saveLog('💾 Creating and downloading CSV file...');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `airbnb_price_tips_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);

    await saveLog('✅ CSV download initiated');
};

chrome.runtime.onMessage.addListener((message: ContentScriptMessage, sender, sendResponse) => {
    console.log('Content script received message:', message);

    const handleMessage = async (): Promise<ContentScriptResponse> => {
        try {
            switch (message.type) {
                case 'GET_BASE_PRICE': {
                    const input = await getBasePriceInput();

                    const raw = input.value;
                    const price = parseFloat(raw.replace(/[^0-9.-]/g, ''));
                    console.log('Base price field raw value:', raw, 'parsed:', price);
                    if (isNaN(price)) {
                        throw new Error(`Could not parse base price from value "${raw}"`);
                    }
                    return { type: 'BASE_PRICE_RESPONSE', price };
                }
                case 'SET_BASE_PRICE': {
                    const input = await getBasePriceInput();
                    console.log('Setting base price to', message.price);
                    input.click();
                    input.focus();

                    input.value = message.price.toString();
                    // Dispatch events to make sure the web app's framework (e.g., React) picks up the change.
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    return { type: 'SUCCESS' };
                }
                case 'INCREASE_BASE_PRICE': {
                    await saveLog('💰 INCREASE_BASE_PRICE: Starting base price increase by $100');
                    const input = await findBasePriceInputAttempt();
                    const currentValue = parseFloat(input.value);
                    await saveLog('📊 INCREASE_BASE_PRICE: Current price:', currentValue);
                    const newValue = currentValue + 100;
                    await saveLog('💰 INCREASE_BASE_PRICE: New price will be:', newValue);
                    console.log('📝 setState(newValue):', newValue);
                    input.focus();
                    setInput(input, newValue.toString());
                    sendKey(input, 'Enter');
                    input.blur();
                    await saveLog('✅ INCREASE_BASE_PRICE: Successfully increased base price from', currentValue);
                    return { type: 'SUCCESS' };
                }
                case 'DECREASE_BASE_PRICE': {
                    await saveLog('💰 DECREASE_BASE_PRICE: Starting base price decrease by -$100');
                    const input = await findBasePriceInputAttempt();
                    const currentValue = parseFloat(input.value);
                    await saveLog('📊 DECREASE_BASE_PRICE: Current price:', currentValue);
                    const newValue = currentValue - 100;
                    await saveLog('💰 DECREASE_BASE_PRICE: New price will be:', newValue);
                    console.log('📝 setState(newValue):', newValue);
                    input.focus();
                    setInput(input, newValue.toString());
                    sendKey(input, 'Enter');
                    input.blur();
                    await saveLog('✅ DECREASE_BASE_PRICE: Successfully decreased base price from', currentValue);
                    return { type: 'SUCCESS' };
                }
                case 'CLICK_SAVE_REFRESH': {
                    await saveLog('🚀 CLICK_SAVE_REFRESH: Preparing to click Save & Refresh');
                    const button = await getSaveRefreshButton();
                    console.log('🎛️ handleEvent called: about to click Save & Refresh', {
                        id: (button as HTMLElement).id,
                        disabled: (button as HTMLButtonElement).disabled,
                        ariaDisabled: button.getAttribute('aria-disabled'),
                        text: button.textContent
                    });
                    button.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    (button as HTMLElement).focus();
                    await waitForButtonEnabled(button);
                    console.log('📡 API call: realClick Save & Refresh');
                    realClick(button);
                    console.log('✅ CLICK_SAVE_REFRESH: Click dispatched');
                    await waitForSaveCompletion(button);
                    try {
                        const inputAfter = await getBasePriceInput();
                        const raw = inputAfter.value;
                        const parsed = parseFloat(raw.replace(/[^0-9.-]/g, ''));
                        console.log('🧪 Post-save UI base price:', { raw, parsed });
                    } catch (e) {
                        console.log('⚠️ Post-save UI base price read failed', e);
                    }
                    return { type: 'SUCCESS' };
                }
                case 'CLICK_SYNC_NOW':
                case 'SYNC_NOW': {
                    const button = await getSyncNowButton();
                    button.click();
                    await saveLog('✅ SYNC_NOW: Sync button clicked successfully');
                    return { type: 'SUCCESS' };
                }
                case 'EDIT_BUTTON': {
                    await saveLog('🎯 EDIT_BUTTON: Looking for Edit button...');
                    const editButton = await findEditButton();
                    editButton.click();
                    await saveLog('✅ EDIT_BUTTON: Edit button clicked successfully');
                    return { type: 'SUCCESS' };
                }
                case 'EDIT_NOW': {
                    await saveLog('🎯 EDIT_NOW: Looking for Edit Now button...');
                    const editNowButton = await findEditNowButton();
                    editNowButton.click();
                    await saveLog('✅ EDIT_NOW: Edit Now button clicked successfully');
                    return { type: 'SUCCESS' };
                }
                case 'EDIT_NOW_POPUP': {
                    await saveLog('🎯 EDIT_NOW_POPUP: Looking for Edit Now popup button...');
                    const editNowPopupButton = await findEditNowPopupButton();
                    editNowPopupButton.click();
                    await saveLog('✅ EDIT_NOW_POPUP: Edit Now popup button clicked successfully');
                    return { type: 'SUCCESS' };
                }
                case 'DUMMY_SYNC_CLICK': {
                    await saveLog('🎭 DUMMY_SYNC_CLICK: Performing dummy sync click (placeholder)');
                    await saveLog('ℹ️ This is a placeholder for actual sync functionality to be implemented later');

                    // For now, just simulate a successful operation
                    // In the future, this would actually click a sync button
                    await new Promise(resolve => setTimeout(resolve, 500));

                    await saveLog('✅ DUMMY_SYNC_CLICK: Dummy sync operation completed');
                    return { type: 'SUCCESS' };
                }
                case 'OCCUPANCY_STEP_1_EDIT': {
                    await occupancyStep1Edit();
                    return { type: 'SUCCESS' };
                }
                case 'OCCUPANCY_STEP_2_SCROLL_FIND_EDIT_PROFILE': {
                    await occupancyStep2ScrollAndFindEditProfile();
                    return { type: 'SUCCESS' };
                }
                case 'OCCUPANCY_STEP_3_CONFIRM_EDIT': {
                    await occupancyStep5ConfirmEdit(); // Reuse the confirm edit function
                    return { type: 'SUCCESS' };
                }
                case 'OCCUPANCY_STEP_4_DOWNLOAD': {
                    await occupancyStep6Download(); // Reuse the download function
                    return { type: 'SUCCESS' };
                }
                case 'OCCUPANCY_STEP_5_CLOSE_POPUP': {
                    await occupancyStep7ClosePopup(); // Close the popup
                    return { type: 'SUCCESS' };
                }
                case 'OCCUPANCY_STEP_6_COMPLETE': {
                    await occupancyStep8Complete(); // Final completion
                    return { type: 'SUCCESS' };
                }
                case 'NAVIGATION_STEP_1_DYNAMIC_PRICING': {
                    await navigationStep1DynamicPricing(); // Click Dynamic Pricing dropdown
                    return { type: 'SUCCESS' };
                }
                case 'NAVIGATION_STEP_2_CUSTOMIZATIONS': {
                    await navigationStep2Customizations(); // Select Customizations option
                    return { type: 'SUCCESS' };
                }
                case 'NAVIGATION_STEP_3_COMPLETE': {
                    await navigationStep3Complete(); // Navigation complete
                    return { type: 'SUCCESS' };
                }
                case 'CUSTOMIZATIONS_STEP_1_LISTINGS': {
                    await customizationsStep1Listings(); // Select Listings tab
                    return { type: 'SUCCESS' };
                }
                case 'CUSTOMIZATIONS_STEP_2_TABLE_VIEW': {
                    await customizationsStep2TableView(); // Select Table View icon
                    return { type: 'SUCCESS' };
                }
                case 'CUSTOMIZATIONS_STEP_3_DOWNLOAD_ALL': {
                    await customizationsStep3DownloadAll(); // Download Customizations for all Listings
                    return { type: 'SUCCESS' };
                }
                case 'CUSTOMIZATIONS_STEP_4_COMPLETE': {
                    await customizationsStep4Complete(); // Complete customizations workflow
                    return { type: 'SUCCESS' };
                }
                case 'MARKET_RESEARCH_STEP_1_DROPDOWN': {
                    await marketResearchStep1Dropdown(); // Click Market Research dropdown
                    return { type: 'SUCCESS' };
                }
                case 'MARKET_RESEARCH_STEP_2_MARKET_DASHBOARD': {
                    await marketResearchStep2MarketDashboard(); // Select Market Dashboard option
                    return { type: 'SUCCESS' };
                }
                case 'MARKET_RESEARCH_STEP_3_COMPLETE': {
                    await marketResearchStep3Complete(); // Complete market research navigation
                    return { type: 'SUCCESS' };
                }
                case 'MARKET_RESEARCH_STEP_4_SHOW_DASHBOARD': {
                    try {
                        console.log('🔍 MESSAGE HANDLER: Starting MARKET_RESEARCH_STEP_4_SHOW_DASHBOARD');
                        await marketResearchStep4ShowDashboard(); // Click Show Dashboard button
                        console.log('✅ MESSAGE HANDLER: MARKET_RESEARCH_STEP_4_SHOW_DASHBOARD completed successfully');
                        return { type: 'SUCCESS' };
                    } catch (error) {
                        console.error('🚨 MESSAGE HANDLER ERROR: MARKET_RESEARCH_STEP_4_SHOW_DASHBOARD failed:', error);
                        return { 
                            type: 'ERROR', 
                            message: `Show Dashboard failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
                        };
                    }
                }
                case 'MARKET_RESEARCH_STEP_5_COMPLETE': {
                    await marketResearchStep5Complete(); // Complete show dashboard workflow (with 15s wait)
                    return { type: 'SUCCESS' };
                }
                case 'MARKET_RESEARCH_STEP_6_DOWNLOAD_PDF': {
                    await marketResearchStep6DownloadPDF(); // Click Download as PDF button (with 15s wait)
                    return { type: 'SUCCESS' };
                }
                case 'MARKET_RESEARCH_STEP_7_COMPLETE': {
                    await marketResearchStep7Complete(); // Complete PDF download workflow
                    return { type: 'SUCCESS' };
                }
                case 'CLICK_ELEMENT': {
                    const button = await waitForElement(message.selector) as HTMLElement;
                    button.click();
                    return { type: 'SUCCESS' };
                }
                case 'WAIT_FOR_ELEMENT_TO_DISAPPEAR': {
                    await waitForElementToDisappear(message.selector, message.timeout);
                    return { type: 'SUCCESS' };
                }
                case 'WAIT_FOR_ELEMENT': {
                    await waitForElement(message.selector, message.timeout);
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
                    await saveLog('🎯 AIRBNB: Looking for Price Tips toggle button...');

                    // Multiple selector strategies for Airbnb Price Tips button
                    const selectors = [
                        'button[data-testid="price-tips-toggle"]',
                        'button[aria-label*="Price tips"]',
                        'button[aria-label*="price tips"]',
                        'button:has-text("Price tips")',
                        'button:has-text("Price Tips")',
                        '[role="button"]:has-text("Price tips")',
                        '[role="button"]:has-text("Price Tips")',
                        'button[class*="price-tips"]',
                        'button[class*="price_tips"]',
                        // Generic fallback for any button containing "price" and "tips"
                        'button:contains("price"):contains("tips")'
                    ];

                    for (const selector of selectors) {
                        try {
                            await saveLog(`🔍 Trying selector: ${selector}`);
                            const toggle = await waitForElement(selector, 1000) as HTMLElement;
                            if (toggle) {
                                await saveLog('✅ Found Price Tips button, clicking...');
                                toggle.click();
                                await saveLog('🎉 Successfully clicked Price Tips button!');

                                // Wait for price tips to load
                                await new Promise(resolve => setTimeout(resolve, 3000));
                                await saveLog('⏳ Waiting for price tips to load...');

                                return { type: 'SUCCESS' };
                            }
                        } catch {
                            // Continue to next selector
                        }
                    }

                    await saveLog('❌ AIRBNB: Price Tips button not found after trying all selectors');
                    throw new Error('Price Tips button not found on Airbnb page');
                }
                case 'EXTRACT_PRICE_TIPS': {
                    await saveLog('📊 AIRBNB: Extracting price tips data from calendar...');

                    const priceData = await extractPriceTipsData();
                    await saveLog(`✅ Extracted ${priceData.length} price tip entries`);

                    return {
                        type: 'PRICE_TIPS_DATA',
                        data: priceData
                    };
                }
                case 'EXPORT_PRICE_TIPS_CSV': {
                    await saveLog('📄 AIRBNB: Exporting price tips to CSV...');

                    const csvContent = await generatePriceTipsCSV(message.priceData);
                    await downloadCSV(csvContent);

                    await saveLog('✅ Price tips CSV exported successfully');
                    
                    return { type: 'SUCCESS' };
                }
                case 'READ_SERVER_BASE_PRICE': {
                    try {
                        const listingIdMatch = location.search.match(/listings=(\d+)/);
                        const listingId = listingIdMatch ? listingIdMatch[1] : '';
                        const url = `/api/fetch_customizations?listingId=${listingId}&pmsName=airbnb&currency=USD`;
                        const res = await fetch(url, { credentials: 'include' });
                        const json = await res.json();
                        // Heuristic: try common fields
                        let serverPrice: number | null = null;
                        const tryFields = ['basePrice', 'base_price', 'defaultBasePrice', 'default_base_price'];
                        const searchObj = (obj: any): number | null => {
                            if (!obj || typeof obj !== 'object') return null;
                            for (const k of Object.keys(obj)) {
                                if (tryFields.includes(k) && typeof obj[k] === 'number') return obj[k];
                                const v = obj[k];
                                if (v && typeof v === 'object') {
                                    const found = searchObj(v);
                                    if (found !== null) return found;
                                }
                            }
                            return null;
                        };
                        serverPrice = searchObj(json);
                        console.log('🛰️ Server customizations parsed base price:', serverPrice);
                        return { type: 'SERVER_BASE_PRICE_RESPONSE', price: serverPrice } as any;
                    } catch (e) {
                        console.log('⚠️ READ_SERVER_BASE_PRICE failed', e);
                        return { type: 'SERVER_BASE_PRICE_RESPONSE', price: null } as any;
                    }
                }
                case 'SNAPSHOT_CALENDAR_PRICES': {
                    try {
                        const cells = Array.from(document.querySelectorAll('[data-testid="calendar-cell"],[role="gridcell"]')) as HTMLElement[];
                        const extractPrice = (cell: HTMLElement): number | null => {
                            const text = (cell.textContent || '').trim();
                            // Prefer currency-marked values
                            const currencyMatch = text.match(/[£$€]\s?([0-9]{2,4})/);
                            if (currencyMatch) {
                                const v = parseInt(currencyMatch[1], 10);
                                if (Number.isFinite(v)) return v;
                            }
                            // Fallback: find all standalone numbers and pick a plausible nightly rate
                            const nums = Array.from(text.matchAll(/\b([0-9]{2,4})\b/g)).map(m => parseInt(m[1], 10)).filter(n => Number.isFinite(n));
                            const plausible = nums.filter(n => n >= 30 && n <= 5000);
                            if (plausible.length > 0) return Math.max(...plausible);
                            return null;
                        };
                        const prices = cells.map(extractPrice).filter((v): v is number => v !== null);
                        const sample = prices.slice(0, 50);
                        console.log('📸 Calendar snapshot prices (sample):', sample);
                        (window as any).__pcpCalendarSnapshot = sample;
                        return { type: 'SUCCESS' };
                    } catch (e) {
                        console.log('⚠️ SNAPSHOT_CALENDAR_PRICES failed', e);
                        return { type: 'SUCCESS' };
                    }
                }
                case 'CHECK_CALENDAR_UPDATED': {
                    try {
                        const before: number[] = (window as any).__pcpCalendarSnapshot || [];
                        const cells = Array.from(document.querySelectorAll('[data-testid="calendar-cell"],[role="gridcell"]')) as HTMLElement[];
                        const extractPrice = (cell: HTMLElement): number | null => {
                            const text = (cell.textContent || '').trim();
                            const currencyMatch = text.match(/[£$€]\s?([0-9]{2,4})/);
                            if (currencyMatch) {
                                const v = parseInt(currencyMatch[1], 10);
                                if (Number.isFinite(v)) return v;
                            }
                            const nums = Array.from(text.matchAll(/\b([0-9]{2,4})\b/g)).map(m => parseInt(m[1], 10)).filter(n => Number.isFinite(n));
                            const plausible = nums.filter(n => n >= 30 && n <= 5000);
                            if (plausible.length > 0) return Math.max(...plausible);
                            return null;
                        };
                        const prices = cells.map(extractPrice).filter((v): v is number => v !== null);
                        const sample = prices.slice(0, 50);
                        const changed = before.length > 0 && sample.length > 0 && (sample.length !== before.length || sample.some((v, i) => v !== before[i]));
                        console.log('🔁 Calendar updated?', changed, 'before:', before.slice(0, 10), 'after:', sample.slice(0, 10));
                        return { type: 'CALENDAR_UPDATED_RESPONSE', changed } as any;
                    } catch (e) {
                        console.log('⚠️ CHECK_CALENDAR_UPDATED failed', e);
                        return { type: 'CALENDAR_UPDATED_RESPONSE', changed: false } as any;
                    }
                }
                case 'FORCE_CALENDAR_RERENDER': {
                    try {
                        // Try month navigation buttons
                        const nextBtn = document.querySelector('[aria-label*="next" i],button[qa-id*="next" i]') as HTMLElement | null;
                        const prevBtn = document.querySelector('[aria-label*="prev" i],button[qa-id*="prev" i]') as HTMLElement | null;
                        if (nextBtn && prevBtn) {
                            nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                            await new Promise(r => setTimeout(r, 800));
                            prevBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                            await new Promise(r => setTimeout(r, 800));
                            console.log('🔄 Forced calendar rerender via month navigation');
                            return { type: 'SUCCESS' };
                        }
                        // Fallback: toggle a known filter checkbox if available
                        const syncToggle = document.getElementById('rp-sync-toggle') as HTMLInputElement | null;
                        if (syncToggle) {
                            syncToggle.click();
                            await new Promise(r => setTimeout(r, 500));
                            syncToggle.click();
                            await new Promise(r => setTimeout(r, 500));
                            console.log('🔄 Forced calendar rerender via sync toggle');
                        }
                        return { type: 'SUCCESS' };
                    } catch (e) {
                        console.log('⚠️ FORCE_CALENDAR_RERENDER failed', e);
                        return { type: 'SUCCESS' };
                    }
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
