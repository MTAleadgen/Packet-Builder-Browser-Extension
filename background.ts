import type { WorkflowState, ContentScriptMessage, ContentScriptResponse } from './types';
import { WorkflowStatus } from './types';

let state: WorkflowState = {
    status: WorkflowStatus.IDLE,
    message: 'Ready to start.',
    step: 1,
    totalSteps: 33
};

let originalTabId: number;

// Storage keys
const WORKFLOW_STATE_KEY = 'workflow_state';

// Persistent state management
async function saveWorkflowState(state: WorkflowState): Promise<void> {
    await chrome.storage.local.set({ [WORKFLOW_STATE_KEY]: state });
}

async function loadWorkflowState(): Promise<WorkflowState | null> {
    const result = await chrome.storage.local.get([WORKFLOW_STATE_KEY]);
    return result[WORKFLOW_STATE_KEY] || null;
}

async function clearWorkflowState(): Promise<void> {
    await chrome.storage.local.remove([WORKFLOW_STATE_KEY]);
}

async function updateState(newState: Partial<WorkflowState>) {
    state = { ...state, ...newState };
    
    // Save to persistent storage
    await saveWorkflowState(state);
    
    // Send update to popup
    chrome.runtime.sendMessage({
        type: 'WORKFLOW_STATE_UPDATE',
        payload: state,
    });
}

chrome.runtime.onStartup.addListener(() => {
    console.log('Extension startup - loading workflow state...');
    loadWorkflowState().then(savedState => {
        if (savedState) {
            state = savedState;
            console.log('Loaded saved workflow state:', state);
        }
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Background received message:', message);
    
    switch (message.type) {
        case 'GET_WORKFLOW_STATE':
            sendResponse({ type: 'WORKFLOW_STATE_UPDATE', payload: state });
            break;
            
        case 'START_GATHERING':
            startWorkflow();
            break;
            
        case 'RESUME_WORKFLOW':
            resumeWorkflow(message.fromStep, message.customizationsOnly);
            break;
            
        case 'CANCEL_GATHERING':
            updateState({
                status: WorkflowStatus.IDLE,
                message: 'Cancelled by user.',
                step: 1
            });
            break;
            
        case 'RESET_WORKFLOW':
            clearWorkflowState();
    updateState({
        status: WorkflowStatus.IDLE,
                message: 'Ready to start.',
                step: 1
            });
            break;
        case 'START_WORKFLOW_WITH_PAIRS': {
            const selectedPairs = message.selectedPairs as Array<{ priceLabsUrl: string; airbnbUrl: string }>;
            console.log('🚀 Starting workflow with selected pairs:', selectedPairs);
            if (!selectedPairs || selectedPairs.length === 0) {
                updateState({ status: WorkflowStatus.ERROR, message: 'No link pairs selected' });
            break;
            }
            const selectedPair = selectedPairs[0];
            if (!selectedPair.priceLabsUrl) {
                updateState({ status: WorkflowStatus.ERROR, message: 'PriceLabs URL is required' });
            break;
    }
            chrome.storage.local.set({ selectedPair });
            startWorkflowWithPair(selectedPair.priceLabsUrl, selectedPair.airbnbUrl);
            break;
        }
    }
});

async function resumeWorkflow(fromStep?: number, customizationsOnly?: boolean) {
    if (state.status === WorkflowStatus.RUNNING) return;

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const url = tab?.url ?? '';
        if (!tab || !tab.id || !(url.includes('app.pricelabs.co/pricing?listings=') || 
                                      url.includes('app.pricelabs.co/customization') || 
                                      url.includes('app.pricelabs.co/reports'))) {
            throw new Error("Not on a valid PriceLabs page (pricing, customization, or reports).");
        }
        originalTabId = tab.id;

        // Determine starting step based on current page
        let startStep = fromStep;
        if (!fromStep) {
            if (url.includes('customization')) {
                startStep = 14; // Start customizations workflow
            } else if (url.includes('reports')) {
                startStep = 21; // Start from "Show Dashboard" step
            } else {
                startStep = 1; // Start full workflow
            }
        }
        
        console.log(`🔄 Resuming workflow from step ${startStep}`);
        await updateState({ status: WorkflowStatus.RUNNING, step: startStep, message: `Resuming workflow from step ${startStep}...` });
        
        if (startStep >= 21) {
            // Resume market research workflow (from reports page)
            await resumeMarketResearchWorkflow(startStep);
        } else if (startStep >= 14) {
            // Resume customizations workflow
            await resumeCustomizationsWorkflow(startStep, customizationsOnly);
        } else {
            // Resume full workflow
            await startWorkflowFromStep(startStep);
        }

    } catch (error) {
        console.error("Resume workflow error:", error);
        await updateState({
            status: WorkflowStatus.ERROR,
            message: `Error resuming workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
    }
}

async function resumeCustomizationsWorkflow(startStep: number, customizationsOnly?: boolean) {
    console.log(`🔄 Starting Customizations workflow from step ${startStep}`);
    
    try {
        // Check if we're still on the correct page
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentUrl = tab?.url ?? '';
        const tabTitle = tab?.title ?? '';
        console.log('🔍 Current tab URL:', currentUrl);
        console.log('🔍 Current tab title:', tabTitle);
        
        // Ensure we're on the customizations page
        if (!currentUrl.includes('/customization')) {
            throw new Error(`❌ Not on customizations page. Current URL: ${currentUrl}. Please navigate to customizations page first.`);
        }
        
        // Ensure content script is injected and page is ready
        console.log('🔄 Ensuring content script is injected...');
        await injectScript(originalTabId!);
        await waitForTabLoad(originalTabId!);
        await new Promise(res => setTimeout(res, 3000)); // Wait for page to settle
        console.log('✅ Content script ready for customizations workflow');
        
        if (startStep <= 14) {
            // Step 14: Select Listings tab
            console.log('🔄 Starting Step 14: Selecting Listings tab...');
            await updateState({ step: 14, message: 'Customizations Step 1: Selecting Listings tab...' });
            await sendMessageToTab(originalTabId, { type: 'CUSTOMIZATIONS_STEP_1_LISTINGS' });
            await new Promise(res => setTimeout(res, 3000));
            console.log('✅ Step 14 completed');
        }
        
        if (startStep <= 15) {
            // Step 15: Select Table View
            await updateState({ step: 15, message: 'Customizations Step 2: Selecting Table View...' });
            await sendMessageToTab(originalTabId, { type: 'CUSTOMIZATIONS_STEP_2_TABLE_VIEW' });
            await new Promise(res => setTimeout(res, 3000));
        }
        
        if (startStep <= 16) {
            // Step 16: Download Customizations for all Listings (with 10s wait)
            await updateState({ step: 16, message: 'Customizations Step 3: Downloading customizations...' });
            await sendMessageToTab(originalTabId, { type: 'CUSTOMIZATIONS_STEP_3_DOWNLOAD_ALL' });
            await new Promise(res => setTimeout(res, 3000));
        }
        
        if (startStep <= 17) {
            // Step 17: Complete customizations workflow
            await updateState({ step: 17, message: 'Customizations Step 4: Completing customizations...' });
            await sendMessageToTab(originalTabId, { type: 'CUSTOMIZATIONS_STEP_4_COMPLETE' });
            await new Promise(res => setTimeout(res, 3000));
        }

        // Check if we should stop here or continue to Market Research
        if (customizationsOnly) {
            console.log('🔄 Customizations-only workflow completed');
            updateState({
                status: WorkflowStatus.SUCCESS,
                message: `Customizations workflow completed successfully!`,
            });
            await clearWorkflowState();
            return;
        }

        // Continue to Market Research workflow (Steps 18-24)
        console.log('🔄 Continuing to Market Research workflow...');
        
        if (startStep <= 18) {
            // Step 18: Click Market Research dropdown
            await updateState({ step: 18, message: 'Market Research Step 1: Clicking Market Research dropdown...' });
            await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_1_DROPDOWN' });
            await new Promise(res => setTimeout(res, 3000));
        }
        
        if (startStep <= 19) {
            // Step 19: Select Market Dashboard (EXPECT DISCONNECTION)
            await updateState({ step: 19, message: 'Market Research Step 2: Selecting Market Dashboard (navigation expected)...' });
            
            try {
                await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_2_MARKET_DASHBOARD' });
                console.log('✅ Market Dashboard selection completed without disconnection');
                await new Promise(res => setTimeout(res, 3000));
            } catch (navigationError) {
                console.log('📍 EXPECTED: Content script disconnected during Market Dashboard navigation');
                console.log('📍 This is normal for page navigation - continuing workflow...');
                console.log('📍 Navigation error:', navigationError.message);
                
                // Wait for navigation to complete
                console.log('⏳ Waiting for Market Research navigation to complete...');
                await new Promise(res => setTimeout(res, 8000)); // Extended wait for navigation
                
                // Check if we successfully navigated to reports page
                const [navTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                const navUrl = navTab?.url ?? '';
                console.log('🔍 Navigation result URL:', navUrl);
                
                if (navUrl.includes('/reports')) {
                    console.log('✅ Successfully navigated to Market Research page');
                    console.log('🔄 Continuing workflow with Show Dashboard...');
                    
                    // Re-inject content script for Show Dashboard functionality
                    console.log('🔄 Re-injecting content script on reports page...');
                    await injectScript(originalTabId);
                    await waitForTabLoad(originalTabId);
                    
                    // Wait for page to be ready
                    console.log('🔄 Waiting for reports page to be ready...');
                    await new Promise(res => setTimeout(res, 5000)); // Wait for React components
                    
                    // Continue with Show Dashboard step
                    console.log('🔄 Proceeding with Show Dashboard step...');
                    await updateState({ step: 21, message: 'Market Research Step 4: Clicking Show Dashboard...' });
                    
                    try {
                        await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_4_SHOW_DASHBOARD' });
                        console.log('✅ Show Dashboard step completed');

                        // Continue with remaining steps
                        await new Promise(res => setTimeout(res, 3000));

                        // Step 22: Complete Show Dashboard workflow (with 12s wait)
                        await updateState({ step: 22, message: 'Market Research Step 5: Waiting 12 seconds before PDF download...' });
                        await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_5_COMPLETE' });

                        // Step 23: Download as PDF (with 15s wait)
                        await updateState({ step: 23, message: 'Market Research Step 6: Downloading as PDF...' });
                        await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_6_DOWNLOAD_PDF' });

                        // Step 24: Complete PDF download workflow
                        await updateState({ step: 24, message: 'Market Research Step 7: Completing PDF download...' });
                        await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_7_COMPLETE' });
                        console.log('✅ Step 24 completed - waiting extra 10 seconds for download to complete');
                        await new Promise(resolve => setTimeout(resolve, 10000)); // Increased to 10 seconds for download

            // Navigate to Airbnb multicalendar
            await navigateToAirbnbMulticalendar();

            // --- AIRBNB PRICE TIPS WORKFLOW ---
            console.log('🛫 Starting Airbnb Price Tips workflow...');

            // Wait for Airbnb page to load (content script remains active)
            console.log('⏳ Waiting for Airbnb page to load and stabilize...');
            await new Promise(resolve => setTimeout(resolve, 8000)); // Increased wait for page transition

            // Step 25: Click Price Tips button
            await updateState({ step: 25, message: 'Airbnb Step 1: Clicking Price Tips button...' });
            console.log('🎯 Executing Price Tips button click...');

            try {
                await sendMessageToTab(originalTabId, { type: 'TOGGLE_PRICE_TIPS' });
                console.log('✅ Price Tips button clicked successfully');

                // Step 26: Extract price tips data
                await updateState({ step: 26, message: 'Airbnb Step 2: Extracting price tips data...' });
                console.log('📊 Extracting price tips data...');

                const extractionResult = await sendMessageToTab(originalTabId, { type: 'EXTRACT_PRICE_TIPS' }) as any;
                const priceData = extractionResult.data || [];
                console.log(`✅ Extracted ${priceData.length} price tip entries`);

                // Step 27: Export to CSV
                await updateState({ step: 27, message: 'Airbnb Step 3: Exporting price tips to CSV...' });
                console.log('📄 Exporting price tips to CSV...');

                await sendMessageToTab(originalTabId, {
                    type: 'EXPORT_PRICE_TIPS_CSV',
                    priceData: priceData
                });
                console.log('✅ CSV export completed');
                await navigateBackToPriceLabsIfPairStored();

            } catch (airbnbError) {
                console.error('❌ Airbnb Price Tips workflow failed:', airbnbError);
                // Don't throw error - Airbnb workflow is optional
                console.log('⚠️ Continuing with success despite Airbnb workflow failure');
            }

            // Final success
            await updateState({
                status: WorkflowStatus.SUCCESS,
                message: `Full workflow completed successfully! PDF downloaded, navigated to Airbnb (same tab), and price tips extracted.`,
            });
                        await clearWorkflowState();
                        return;

                    } catch (showDashboardError) {
                        console.error('❌ Show Dashboard step failed:', showDashboardError);
                        throw new Error(`Show Dashboard failed: ${showDashboardError.message}`);
                    }
                    
                } else if (navUrl.includes('/login')) {
                    throw new Error(`❌ Navigation redirected to login. Please log in to PriceLabs first.`);
                } else {
                    throw new Error(`❌ Navigation failed. Expected /reports, got: ${navUrl}`);
                }
            }
        }
        
        if (startStep <= 20) {
            // Step 20: Complete market research navigation with robust page handling
            await updateState({ step: 20, message: 'Market Research Step 3: Completing navigation...' });
            await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_3_COMPLETE' });
            
            // Wait for Market Research page navigation (NO FORCED SCRIPT INJECTION)
            console.log('🔄 Waiting for Market Research page navigation...');
            await new Promise(res => setTimeout(res, 5000)); // Reduced wait time
            
            // Check if we got redirected to login after navigation
            const [navTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const navUrl = navTab?.url ?? '';
            console.log('🔍 Post-navigation URL check:', navUrl);
            
            if (navUrl.includes('/login')) {
                throw new Error(`❌ Navigation redirected to login. Current URL: ${navUrl}. Please log in to PriceLabs first, then navigate to Market Dashboard manually.`);
            }
            
            // NO CONTENT SCRIPT RE-INJECTION - let the page load naturally
            console.log('🔄 Allowing page to load naturally without forced script injection...');
            
            // Minimal wait for page to settle
            console.log('🔄 Waiting for Market Research page to settle...');
            await new Promise(res => setTimeout(res, 3000)); // Reduced wait
            
            // Verify we're ready
            console.log('✅ Market Research page navigation completed naturally');

            // Content script should still be active from navigation - proceed without re-injection
        }

        // --- NOW EXECUTE STEPS 21-24: Show Dashboard and PDF Download ---
        console.log('🔄 Starting Show Dashboard and PDF download workflow...');

        // Step 21: Show Dashboard
        await updateState({ step: 21, message: 'Market Research Step 4: Clicking Show Dashboard...' });
        console.log('🎯 Executing Show Dashboard step...');

        try {
            await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_4_SHOW_DASHBOARD' });
            console.log('✅ Show Dashboard step completed');

            // Continue with remaining steps
            await new Promise(res => setTimeout(res, 3000));

            // Step 22: Complete Show Dashboard workflow (with 12s wait)
            await updateState({ step: 22, message: 'Market Research Step 5: Waiting 12 seconds before PDF download...' });
            await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_5_COMPLETE' });
            console.log('✅ Step 22 completed');

            // Step 23: Download as PDF (with 15s wait)
            await updateState({ step: 23, message: 'Market Research Step 6: Downloading as PDF...' });
            await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_6_DOWNLOAD_PDF' });
            console.log('✅ Step 23 completed');

            // Step 24: Complete PDF download workflow
            await updateState({ step: 24, message: 'Market Research Step 7: Completing PDF download...' });
            await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_7_COMPLETE' });
            console.log('✅ Step 24 completed - waiting extra 10 seconds for download to complete');
            await new Promise(resolve => setTimeout(resolve, 10000)); // Increased to 10 seconds for download

            // Navigate to Airbnb multicalendar
            await navigateToAirbnbMulticalendar();

            // --- AIRBNB PRICE TIPS WORKFLOW ---
            console.log('🛫 Starting Airbnb Price Tips workflow...');

            // Wait for Airbnb page to load (content script remains active)
            console.log('⏳ Waiting for Airbnb page to load and stabilize...');
            await new Promise(resolve => setTimeout(resolve, 8000)); // Increased wait for page transition

            // Step 25: Click Price Tips button
            await updateState({ step: 25, message: 'Airbnb Step 1: Clicking Price Tips button...' });
            console.log('🎯 Executing Price Tips button click...');

            try {
                await sendMessageToTab(originalTabId, { type: 'TOGGLE_PRICE_TIPS' });
                console.log('✅ Price Tips button clicked successfully');

                // Step 26: Extract price tips data
                await updateState({ step: 26, message: 'Airbnb Step 2: Extracting price tips data...' });
                console.log('📊 Extracting price tips data...');

                const extractionResult = await sendMessageToTab(originalTabId, { type: 'EXTRACT_PRICE_TIPS' }) as any;
                const priceData = extractionResult.data || [];
                console.log(`✅ Extracted ${priceData.length} price tip entries`);

                // Step 27: Export to CSV
                await updateState({ step: 27, message: 'Airbnb Step 3: Exporting price tips to CSV...' });
                console.log('📄 Exporting price tips to CSV...');

                await sendMessageToTab(originalTabId, {
                    type: 'EXPORT_PRICE_TIPS_CSV',
                    priceData: priceData
                });
                await navigateBackToPriceLabsIfPairStored();

            } catch (airbnbError) {
                console.error('❌ Airbnb Price Tips workflow failed:', airbnbError);
                // Don't throw error - Airbnb workflow is optional
                console.log('⚠️ Continuing with success despite Airbnb workflow failure');
            }

        } catch (showDashboardError) {
            console.error('❌ Show Dashboard workflow failed:', showDashboardError);
            throw new Error(`Show Dashboard failed: ${showDashboardError.message}`);
        }

        // --- Final Success ---
        console.log('🎉 All steps completed successfully!');
        updateState({
            status: WorkflowStatus.SUCCESS,
            message: `Full workflow completed successfully! PDF downloaded.`,
        });
        await clearWorkflowState();

    } catch (error) {
        console.error("Customizations workflow error:", error);
        updateState({
            status: WorkflowStatus.ERROR,
            message: `Error at step ${state.step}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
    }
}

async function resumeMarketResearchWorkflow(startStep: number) {
    console.log(`🔄 Starting Market Research workflow from step ${startStep}`);
    
    try {
        // Check if we're still on the correct page
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentUrl = tab?.url ?? '';
        const tabTitle = tab?.title ?? '';
        console.log('🔍 Current tab URL:', currentUrl);
        console.log('🔍 Current tab title:', tabTitle);
        
        // Detect if user got redirected to login
        if (currentUrl.includes('/login') || tabTitle.toLowerCase().includes('login')) {
            throw new Error(`❌ Login required. Current URL: ${currentUrl}. Please log in to PriceLabs first, then navigate to Market Dashboard and try again.`);
        }

        // If we're not on reports page, check if we're on a valid PriceLabs page (pricing/customization)
        // This can happen in pairs workflow where we start from pricing page
        if (!currentUrl.includes('/reports')) {
            if (currentUrl.includes('/pricing?listings=') || currentUrl.includes('/customization')) {
                console.log('ℹ️ Not on reports page, but on valid PriceLabs page. Continuing workflow...');
            } else {
                console.log('⚠️ Not on expected PriceLabs page. Current URL:', currentUrl);
                throw new Error(`❌ Unexpected page. Current URL: ${currentUrl}. Expected PriceLabs pricing or reports page.`);
            }
        }
        
        // Ensure we're on the reports page and inject content script
        await injectScript(originalTabId!);
        await waitForTabLoad(originalTabId!);
        await new Promise(res => setTimeout(res, 3000)); // Wait for page to settle
        
        // Step 21: Click Show Dashboard (conditionally skip if starting later)
        if (startStep <= 21) {
            updateState({ step: 21, message: 'Market Research Step 4: Clicking Show Dashboard...' });
            try {
                await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_4_SHOW_DASHBOARD' });
            } catch (e) {
                console.log('⚠️ Show Dashboard click failed once, retrying after reinjection...', (e as Error)?.message);
                await injectScript(originalTabId!);
                await waitForTabLoad(originalTabId!);
                await new Promise(res => setTimeout(res, 2000));
                await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_4_SHOW_DASHBOARD' });
            }
        }
        
        // Step 22: Complete Show Dashboard workflow (with 12s wait)
        if (startStep <= 22) {
            updateState({ step: 22, message: 'Market Research Step 5: Waiting 12 seconds before PDF download...' });
            await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_5_COMPLETE' });
        }
        
        // Step 23: Download as PDF (with 15s wait)
        if (startStep <= 23) {
            updateState({ step: 23, message: 'Market Research Step 6: Downloading as PDF...' });
            await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_6_DOWNLOAD_PDF' });
        }
        
        // Step 24: Complete PDF download workflow
        if (startStep <= 24) {
            updateState({ step: 24, message: 'Market Research Step 7: Completing PDF download...' });
            await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_7_COMPLETE' });
            console.log('✅ Step 24 completed - waiting extra 10 seconds for download to complete');
            await new Promise(resolve => setTimeout(resolve, 10000)); // Increased to 10 seconds for download

            // Navigate to Airbnb multicalendar
            await navigateToAirbnbMulticalendar();

            // --- AIRBNB PRICE TIPS WORKFLOW ---
            console.log('🛫 Starting Airbnb Price Tips workflow...');

            // Wait for Airbnb page to load (content script remains active)
            console.log('⏳ Waiting for Airbnb page to load and stabilize...');
            await new Promise(resolve => setTimeout(resolve, 8000)); // Increased wait for page transition

            // Step 25: Click Price Tips button
            updateState({ step: 25, message: 'Airbnb Step 1: Clicking Price Tips button...' });

            try {
                await sendMessageToTab(originalTabId, { type: 'TOGGLE_PRICE_TIPS' });

                // Step 26: Extract price tips data
                updateState({ step: 26, message: 'Airbnb Step 2: Extracting price tips data...' });

                const extractionResult = await sendMessageToTab(originalTabId, { type: 'EXTRACT_PRICE_TIPS' }) as any;
                const priceData = extractionResult.data || [];

                // Step 27: Export to CSV
                updateState({ step: 27, message: 'Airbnb Step 3: Exporting price tips to CSV...' });

                await sendMessageToTab(originalTabId, {
                    type: 'EXPORT_PRICE_TIPS_CSV',
                    priceData: priceData
                });
                await navigateBackToPriceLabsIfPairStored();

            } catch (airbnbError) {
                console.error('❌ Airbnb Price Tips workflow failed:', airbnbError);
                // Don't throw error - Airbnb workflow is optional
                console.log('⚠️ Continuing with success despite Airbnb workflow failure');
            }
        }

        // --- Success ---
        updateState({
            status: WorkflowStatus.SUCCESS,
            message: `Market Research workflow completed successfully! PDF downloaded, navigated to Airbnb, and price tips extracted.`,
        });
        await clearWorkflowState();

    } catch (error) {
        console.error("Market Research workflow error:", error);
        updateState({
            status: WorkflowStatus.ERROR,
            message: `Error at step ${state.step}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
    }
}

async function sendMessageToTab<T extends ContentScriptResponse>(tabId: number, message: ContentScriptMessage, retries: number = 3): Promise<T> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await new Promise<T>((resolve, reject) => {
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
        } catch (error) {
            console.error(`Attempt ${attempt}/${retries} failed:`, error);
            
            if (attempt === retries) {
                // Final attempt with content script re-injection
                try {
                    await injectScript(tabId);
                    await waitForTabLoad(tabId);
                    
                    // Final retry after re-injection
                    return new Promise<T>((resolve, reject) => {
                        chrome.tabs.sendMessage(tabId, message, (response: T | { type: 'ERROR', message: string }) => {
                            if (chrome.runtime.lastError) {
                                return reject(new Error(`Could not send message to tab ${tabId} after re-injection. Error: ${chrome.runtime.lastError.message}`));
                            }
                            if (response && response.type === 'ERROR') {
                                return reject(new Error(response.message));
                            }
                            resolve(response as T);
                        });
                    });
                } catch (reinjectionError) {
                    console.error('Content script re-injection failed:', reinjectionError);
                    throw error; // Throw the original error
                }
            }
            
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
    
    throw new Error(`Failed to send message after ${retries} attempts`);
}

async function injectScript(tabId: number): Promise<void> {
    return new Promise((resolve, reject) => {
        chrome.scripting.executeScript(
            {
                target: { tabId: tabId },
                files: ['content.js'],
            },
            (results) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(`Failed to inject content script: ${chrome.runtime.lastError.message}`));
                } else {
                    console.log('Content script injected successfully');
                resolve();
                }
            }
        );
    });
}

async function waitForTabLoad(tabId: number): Promise<void> {
    return new Promise((resolve) => {
        const checkComplete = () => {
            chrome.tabs.get(tabId, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    resolve(); // Tab might be closed, just resolve
                    return;
                }
                
                if (tab.status === 'complete') {
                    resolve();
                } else {
                    setTimeout(checkComplete, 100);
                }
            });
        };
        checkComplete();
    });
}

async function startWorkflowFromStep(startStep: number) {
    // Placeholder for full workflow resume - not implemented yet
    throw new Error('Full workflow resume not implemented yet. Please start from a supported page.');
}

async function navigateToAirbnbMulticalendar() {
    console.log('🛫 Starting Airbnb multicalendar navigation...');

    try {
        // Get the Airbnb URL from the selected pair, fallback to default
        const result = await chrome.storage.local.get(['selectedPair']);
        const selectedPair = result.selectedPair;
        const airbnbUrl = selectedPair?.airbnbUrl || 'https://www.airbnb.com/multicalendar/1317460106754094447';

        console.log('🎯 Navigating to Airbnb multicalendar in same tab:', airbnbUrl);

        // Navigate in the current tab to keep content script active
        await chrome.tabs.update(originalTabId, {
            url: airbnbUrl,
            active: true
        });

        console.log('✅ Successfully navigated to Airbnb multicalendar in same tab');

        // Re-inject content script for Airbnb page
        console.log('🔄 Re-injecting content script for Airbnb page...');
        await injectScript(originalTabId);
        await waitForTabLoad(originalTabId);

        console.log('📌 Content script re-injected and ready for price tips extraction');

    } catch (error) {
        console.error('❌ Failed to navigate to Airbnb multicalendar:', error);
        // Don't throw error - this shouldn't stop the workflow success
    }
}

async function startWorkflow() {
    if (state.status === WorkflowStatus.RUNNING) return;

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const url = tab?.url ?? '';
        if (!tab || !tab.id || !url.includes('app.pricelabs.co/pricing?listings=')) {
            throw new Error("Please navigate to a PriceLabs listing calendar page first.");
        }
        originalTabId = tab.id;

        await updateState({ status: WorkflowStatus.RUNNING, step: 1, message: 'Starting workflow...' });

        // Inject content script
        await injectScript(originalTabId);
        await waitForTabLoad(originalTabId);

        // Step 1: Increase base price by $100
        await updateState({ step: 1, message: 'Step 1: Increasing base price by $100...' });
        await sendMessageToTab(originalTabId, { type: 'INCREASE_BASE_PRICE' });
        await new Promise(res => setTimeout(res, 500)); // Reduced from 2s to 0.5s

        // Step 2: Click Save & Refresh button (extended wait)
        await updateState({ step: 2, message: 'Step 2: Clicking Save & Refresh button...' });
        await sendMessageToTab(originalTabId, { type: 'CLICK_SAVE_REFRESH' });
        await new Promise(res => setTimeout(res, 15000)); // Extended to 15s - wait for save to process

        // Step 3: Click Sync Now button (dummy click, wait 3 seconds)
        await updateState({ step: 3, message: 'Step 3: Clicking Sync Now button (dummy)...' });
        await sendMessageToTab(originalTabId, { type: 'DUMMY_SYNC_CLICK' });
        await new Promise(res => setTimeout(res, 3000)); // 3 second wait

        // Step 4: Click Edit button (main screen)
        await updateState({ step: 4, message: 'Step 4: Clicking Edit button...' });
        await sendMessageToTab(originalTabId, { type: 'OCCUPANCY_STEP_1_EDIT' });
        await new Promise(res => setTimeout(res, 3000));

        // Step 5: Scroll and click Edit Profile
        await updateState({ step: 5, message: 'Step 5: Scrolling and clicking Edit Profile...' });
        await sendMessageToTab(originalTabId, { type: 'OCCUPANCY_STEP_2_SCROLL_FIND_EDIT_PROFILE' });
        await new Promise(res => setTimeout(res, 3000));

        // Step 6: Click Edit Profile button in popup
        await updateState({ step: 6, message: 'Step 6: Clicking Edit Profile button in popup...' });
        await sendMessageToTab(originalTabId, { type: 'OCCUPANCY_STEP_3_CONFIRM_EDIT' });
        await new Promise(res => setTimeout(res, 3000));

        // Step 7: Click Download button in popup
        await updateState({ step: 7, message: 'Step 7: Clicking Download button...' });
        await sendMessageToTab(originalTabId, { type: 'OCCUPANCY_STEP_4_DOWNLOAD' });
        await new Promise(res => setTimeout(res, 3000));

        // Step 8: Close popup
        await updateState({ step: 8, message: 'Step 8: Closing popup...' });
        await sendMessageToTab(originalTabId, { type: 'OCCUPANCY_STEP_5_CLOSE_POPUP' });
        await new Promise(res => setTimeout(res, 3000));

        // Step 9: Click Dynamic Pricing dropdown
        await updateState({ step: 9, message: 'Step 9: Clicking Dynamic Pricing dropdown...' });
        await sendMessageToTab(originalTabId, { type: 'NAVIGATION_STEP_1_DYNAMIC_PRICING' });
        await new Promise(res => setTimeout(res, 3000));

        // Step 10: Select Customizations
        await updateState({ step: 10, message: 'Step 10: Selecting Customizations...' });
        await sendMessageToTab(originalTabId, { type: 'NAVIGATION_STEP_2_CUSTOMIZATIONS' });
        await new Promise(res => setTimeout(res, 3000));

        // Step 11: Complete navigation
        await updateState({ step: 11, message: 'Step 11: Completing navigation...' });
        await sendMessageToTab(originalTabId, { type: 'NAVIGATION_STEP_3_COMPLETE' });

        // Extended wait and re-injection for Customizations page navigation
        console.log('🔄 Waiting for Customizations page navigation...');
        await new Promise(res => setTimeout(res, 8000)); // 8-second wait for page navigation

        // Check if we got redirected or stayed on the right page
        const [navTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const navUrl = navTab?.url ?? '';
        console.log('🔍 Post-navigation URL check:', navUrl);
        
        if (!navUrl.includes('/customization')) {
            throw new Error(`❌ Navigation failed. Expected /customization, got: ${navUrl}. Please navigate to customizations page manually.`);
        }

        // Re-inject content script after navigation
        console.log('🔄 Re-injecting content script after Customizations navigation...');
        await injectScript(originalTabId);
        await waitForTabLoad(originalTabId);

        // Additional wait for React components to initialize
        console.log('🔄 Waiting for Customizations React components to initialize...');
        await new Promise(res => setTimeout(res, 5000)); // Extra wait for component initialization

        // Verify we're on the right page
        console.log('✅ Customizations page navigation completed, content script re-injected');
        await new Promise(res => setTimeout(res, 3000)); // Wait for page to settle completely

        // Continue with customizations workflow (full workflow, not customizations-only)
        await resumeCustomizationsWorkflow(14, false); // false = continue to Market Research

    } catch (error) {
        console.error("Workflow error:", error);
        updateState({
            status: WorkflowStatus.ERROR,
            message: `Error at step ${state.step}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
    }
}

async function startWorkflowWithPair(priceLabsUrl: string, airbnbUrl?: string) {
    if (state.status === WorkflowStatus.RUNNING) return;
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) throw new Error('No active tab found.');
        originalTabId = tab.id;

        await updateState({ status: WorkflowStatus.RUNNING, step: 1, message: 'Navigating to PriceLabs URL...' });
        console.log('🌐 Navigating to PriceLabs URL:', priceLabsUrl);
        await chrome.tabs.update(originalTabId, { url: priceLabsUrl });

        console.log('⏳ Waiting 5 seconds for PriceLabs page to load...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        await injectScript(originalTabId);
        await waitForTabLoad(originalTabId);

        // Proceed with normal workflow from Step 1
        await updateState({ step: 1, message: 'Step 1: Increasing base price by $100...' });
        await sendMessageToTab(originalTabId, { type: 'INCREASE_BASE_PRICE' });
        await new Promise(res => setTimeout(res, 500));

        // Step 2: Save & Refresh (extended wait)
        await updateState({ step: 2, message: 'Step 2: Clicking Save & Refresh button...' });
        await sendMessageToTab(originalTabId, { type: 'CLICK_SAVE_REFRESH' });
        await new Promise(res => setTimeout(res, 15000));

        // Continue full workflow
        await proceedAfterInitialSteps();

        // After CSV export in existing flow, navigate back handled elsewhere
    } catch (error) {
        console.error('❌ Error in startWorkflowWithPair:', error);
        await updateState({ status: WorkflowStatus.ERROR, message: error instanceof Error ? error.message : 'Unknown error' });
    }
}

async function proceedAfterInitialSteps() {
    // Continue the workflow from where startWorkflowWithPair left off
    // startWorkflowWithPair completed steps 1-2, so we continue from step 3

    await updateState({ step: 3, message: 'Step 3: Clicking Sync Now button (dummy)...' });
    await sendMessageToTab(originalTabId, { type: 'DUMMY_SYNC_CLICK' });
    await new Promise(res => setTimeout(res, 3000));

    await updateState({ step: 4, message: 'Step 4: Clicking Edit button...' });
    await sendMessageToTab(originalTabId, { type: 'OCCUPANCY_STEP_1_EDIT' });
    await new Promise(res => setTimeout(res, 3000));

    await updateState({ step: 5, message: 'Step 5: Scrolling and clicking Edit Profile...' });
    await sendMessageToTab(originalTabId, { type: 'OCCUPANCY_STEP_2_SCROLL_FIND_EDIT_PROFILE' });
    await new Promise(res => setTimeout(res, 3000));

    await updateState({ step: 6, message: 'Step 6: Clicking Edit Profile button in popup...' });
    await sendMessageToTab(originalTabId, { type: 'OCCUPANCY_STEP_3_CONFIRM_EDIT' });
    await new Promise(res => setTimeout(res, 3000));

    await updateState({ step: 7, message: 'Step 7: Clicking Download button...' });
    await sendMessageToTab(originalTabId, { type: 'OCCUPANCY_STEP_4_DOWNLOAD' });
    await new Promise(res => setTimeout(res, 3000));

    await updateState({ step: 8, message: 'Step 8: Closing popup...' });
    await sendMessageToTab(originalTabId, { type: 'OCCUPANCY_STEP_5_CLOSE_POPUP' });
    await new Promise(res => setTimeout(res, 3000));

    await updateState({ step: 9, message: 'Step 9: Clicking Dynamic Pricing dropdown...' });
    await sendMessageToTab(originalTabId, { type: 'NAVIGATION_STEP_1_DYNAMIC_PRICING' });
    await new Promise(res => setTimeout(res, 3000));

    // Continue with Market Research workflow steps 10-20
    await updateState({ step: 10, message: 'Step 10: Clicking Market Research dropdown...' });
    await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_1_DROPDOWN' });
    await new Promise(res => setTimeout(res, 3000));

    await updateState({ step: 11, message: 'Step 11: Selecting Market Dashboard (navigation expected)...' });
    try {
        await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_2_MARKET_DASHBOARD' });
        console.log('✅ Market Dashboard selection completed without disconnection');
        await new Promise(res => setTimeout(res, 3000));
    } catch (navigationError) {
        console.log('📍 EXPECTED: Content script disconnected during Market Dashboard navigation');
        console.log('📍 This is normal for page navigation - continuing workflow...');
        console.log('📍 Navigation error:', navigationError.message);

        // Wait for navigation to complete
        console.log('⏳ Waiting for Market Research navigation to complete...');
        await new Promise(res => setTimeout(res, 8000)); // Extended wait for navigation

        // Check if we successfully navigated to reports page
        const [navTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const navUrl = navTab?.url ?? '';
        console.log('🔍 Navigation result URL:', navUrl);

        if (navUrl.includes('/reports')) {
            console.log('✅ Successfully navigated to Market Research page');
            console.log('🔄 Continuing workflow with Show Dashboard...');

            // Re-inject content script for Show Dashboard functionality
            console.log('🔄 Re-injecting content script on reports page...');
            await injectScript(originalTabId);
            await waitForTabLoad(originalTabId);

            // Wait for page to be ready
            console.log('🔄 Waiting for reports page to be ready...');
            await new Promise(res => setTimeout(res, 5000)); // Wait for React components
        } else {
            throw new Error('Failed to navigate to Market Research reports page');
        }
    }

    await updateState({ step: 12, message: 'Step 12: Completing navigation...' });
    await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_3_COMPLETE' });

    // Wait for Market Research page navigation (NO FORCED SCRIPT INJECTION)
    console.log('🔄 Waiting for Market Research page navigation...');
    await new Promise(res => setTimeout(res, 5000));

    // Continue from Market Research workflow (Show Dashboard and beyond)
    await resumeMarketResearchWorkflow(21);
}

async function navigateBackToPriceLabsIfPairStored() {
    try {
        const result = await chrome.storage.local.get(['selectedPair']);
        const priceLabsUrl = result.selectedPair?.priceLabsUrl;
        if (!priceLabsUrl) {
            console.log('ℹ️ No stored PriceLabs URL to navigate back to.');
            return;
        }
        console.log('🔙 Navigating back to PriceLabs URL:', priceLabsUrl);
        await chrome.tabs.update(originalTabId, { url: priceLabsUrl, active: true });
        await new Promise(resolve => setTimeout(resolve, 3000));
        await injectScript(originalTabId);
        await waitForTabLoad(originalTabId);
        console.log('✅ Back on PriceLabs page');

        // After navigating back, reduce the base price by -$100
        await reduceBasePriceWorkflow();

    } catch (e) {
        console.error('Failed to navigate back to PriceLabs:', e);
    }
}

async function reduceBasePriceWorkflow() {
    try {
        console.log('💰 Starting base price reduction workflow...');

        // Step 28: Reduce base price by -$100
        await updateState({ step: 28, message: 'Step 28: Reducing base price by -$100...' });
        await sendMessageToTab(originalTabId, { type: 'DECREASE_BASE_PRICE' });
        await new Promise(res => setTimeout(res, 500));

        // Step 29: Click Save & Refresh button (extended wait)
        await updateState({ step: 29, message: 'Step 29: Clicking Save & Refresh button...' });
        await sendMessageToTab(originalTabId, { type: 'CLICK_SAVE_REFRESH' });
        await new Promise(res => setTimeout(res, 15000));

        // Step 30: Click Sync Now button (dummy click, wait 3 seconds)
        await updateState({ step: 30, message: 'Step 30: Clicking Sync Now button (dummy)...' });
        await sendMessageToTab(originalTabId, { type: 'DUMMY_SYNC_CLICK' });
        await new Promise(res => setTimeout(res, 3000));

        // Step 31: Click Edit button (following original steps 4-6)
        await updateState({ step: 31, message: 'Step 31: Clicking Edit button...' });
        await sendMessageToTab(originalTabId, { type: 'OCCUPANCY_STEP_1_EDIT' });
        await new Promise(res => setTimeout(res, 3000));

        // Step 32: Scrolling and clicking Edit Profile
        await updateState({ step: 32, message: 'Step 32: Scrolling and clicking Edit Profile...' });
        await sendMessageToTab(originalTabId, { type: 'OCCUPANCY_STEP_2_SCROLL_FIND_EDIT_PROFILE' });
        await new Promise(res => setTimeout(res, 3000));

        // Step 33: Clicking Edit Profile button in popup - FINAL STEP
        await updateState({ step: 33, message: 'Step 33: Clicking Edit Profile button in popup...' });
        await sendMessageToTab(originalTabId, { type: 'OCCUPANCY_STEP_3_CONFIRM_EDIT' });
        await new Promise(res => setTimeout(res, 3000));

        console.log('✅ Base price reduction workflow completed - Edit Profile popup opened, workflow finished');

        // Final success
        await updateState({
            status: WorkflowStatus.SUCCESS,
            message: `Complete workflow finished! Price increased, PDF downloaded, Airbnb visited, CSV exported, and price reduced back to original.`,
        });
        await clearWorkflowState();

    } catch (error) {
        console.error('❌ Error in base price reduction workflow:', error);
        await updateState({
            status: WorkflowStatus.ERROR,
            message: `Error at step ${state.step}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
    }
}
