import type { WorkflowState, ContentScriptMessage, ContentScriptResponse } from './types';
import { WorkflowStatus } from './types';

let state: WorkflowState = {
    status: WorkflowStatus.IDLE,
    message: 'Ready to start.',
    step: 1,
    totalSteps: 31
};

let originalTabId: number;
let apiTokenGlobal: string | undefined;
let didAirbnbTips = false;
// Clean zoom implementation with proper storage keys
const ZOOM_OUT = 0.25;
const zk = id => `zoom_${id}`, wk = id => `win_${id}`;

async function getActive(){ return (await chrome.tabs.query({active:true,currentWindow:true}))[0]; }

async function zoomFull(tabId?: number){
  const tab = tabId ? await chrome.tabs.get(tabId) : await getActive();
  const win = await chrome.windows.get(tab.windowId);
  const prevZoom = await chrome.tabs.getZoom(tab.id);
  await chrome.storage.local.set({ [zk(tab.id)]: prevZoom, [wk(win.id)]: win.state });
  await chrome.tabs.setZoomSettings(tab.id, { mode:"automatic", scope:"per-tab" });
  await chrome.tabs.setZoom(tab.id, ZOOM_OUT);
  await chrome.windows.update(win.id, { state:"fullscreen" });
}

async function zoomRestore(tabId?: number){
  const tab = tabId ? await chrome.tabs.get(tabId) : await getActive();
  const win = await chrome.windows.get(tab.windowId);
  const st = await chrome.storage.local.get([zk(tab.id), wk(win.id)]);
  await chrome.tabs.setZoom(tab.id, st[zk(tab.id)] ?? 1);
  if (win.state === "fullscreen") await chrome.windows.update(win.id, { state: st[wk(win.id)] ?? "normal" });
}

async function persistLog(message: string, data?: any) {
    try {
        const existing = await chrome.storage.local.get(['pcp_logs']);
        const logs = Array.isArray(existing.pcp_logs) ? existing.pcp_logs : [];
        const entry = { ts: Date.now(), message, data };
        logs.push(entry);
        if (logs.length > 300) logs.splice(0, logs.length - 300);
        await chrome.storage.local.set({ pcp_logs: logs });
        console.log('🧾 LOGGED:', message, data ?? '');
    } catch (e) {
        console.error('❌ Failed to persist log:', e);
    }
}

// Test function for debugging persistent logs
async function testPersistentLogs() {
    console.log('🧾 Testing persistent logging...');
    await persistLog('TEST: Manual test of persistent logging', {
        timestamp: Date.now(),
        testData: 'This is a test entry'
    });
    console.log('✅ Test log saved - check chrome.storage.local.get("pcp_logs")');
}

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
        case 'zoom_full':
        case 'ZOOM_FULL': {
            (async () => {
                try {
                    await zoomFull(sender?.tab?.id);
                    sendResponse?.({ ok: true });
                } catch (e) {
                    console.warn('zoom_full failed', (e as Error)?.message);
                    sendResponse?.({ ok: false, error: (e as Error)?.message });
                }
            })();
            return true;
        }
        case 'zoom_restore':
        case 'ZOOM_RESTORE': {
            (async () => {
                try {
                    await zoomRestore(sender?.tab?.id);
                    sendResponse?.({ ok: true });
                } catch (e) {
                    console.warn('zoom_restore failed', (e as Error)?.message);
                    sendResponse?.({ ok: false, error: (e as Error)?.message });
                }
            })();
            return true;
        }
        case 'SCREENSHOT': {
            (async () => {
                try {
                    const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: 'png' });
                    const filename = `tips-${Date.now()}.png`;
                    await chrome.downloads.download({ url: dataUrl, filename });
                    sendResponse?.({ ok: true, filename });
                } catch (e) {
                    console.warn('SCREENSHOT failed', (e as Error)?.message);
                    sendResponse?.({ ok: false, error: (e as Error)?.message });
                }
            })();
            return true;
        }
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
            apiTokenGlobal = (message as any).apiToken;
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
        case 'TEST_PERSISTENT_LOGS': {
            (async () => {
                try {
                    console.log('🧾 Testing persistent logging system...');
                    await persistLog('TEST: Manual test of persistent logging', {
                        timestamp: Date.now(),
                        testData: 'This is a test entry from TEST_PERSISTENT_LOGS'
                    });
                    console.log('✅ Test log saved - check chrome.storage.local.get("pcp_logs")');
                    sendResponse?.({ ok: true, message: 'Test log saved successfully' });
                } catch (e) {
                    console.warn('❌ Test persistent logs failed:', (e as Error)?.message);
                    sendResponse?.({ ok: false, error: (e as Error)?.message });
                }
            })();
            return true;
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

            // Step 22: Click Price Tips button
            await updateState({ step: 22, message: 'Airbnb Step 1: Clicking Price Tips button...' });
            console.log('🎯 Executing Price Tips button click...');

            const tab = await chrome.tabs.get(originalTabId);
            if (!tab.windowId) throw new Error("Tab does not have a windowId.");
            const originalWindow = await chrome.windows.get(tab.windowId);
            const originalZoom = await chrome.tabs.getZoom(originalTabId);

            try {
                await sendMessageToTab(originalTabId, { type: 'TOGGLE_PRICE_TIPS' });
                console.log('✅ Price Tips button clicked successfully');
                didAirbnbTips = true;
                await persistLog('Airbnb: Price Tips opened');

                // Step 23: Zoom out and go fullscreen to see all months (via new zoom API)
                await updateState({ step: 23, message: 'Airbnb Step 2: Zooming out and entering fullscreen...' });
                console.log('🔍 Zooming out and entering fullscreen (service worker)...');
                await new Promise<void>((resolve, reject) => chrome.runtime.sendMessage({ type: 'ZOOM_FULL' }, (resp) => {
                    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                    if (!resp?.ok) return reject(new Error(resp?.error || 'ZOOM_FULL failed'));
                    resolve();
                }));
                await new Promise(resolve => setTimeout(resolve, 1500));

                // Step 24: Extract price tips data
                await updateState({ step: 24, message: 'Airbnb Step 3: Extracting price tips data...' });
                console.log('📊 Extracting price tips data...');

                const extractionResult = await sendMessageToTab(originalTabId, { type: 'EXTRACT_PRICE_TIPS' }) as any;
                const priceData = extractionResult.data || [];
                console.log(`✅ Extracted ${priceData.length} price tip entries`);

                // Step 25: Export to CSV
                await updateState({ step: 25, message: 'Airbnb Step 4: Exporting price tips to CSV...' });
                console.log('📄 Exporting price tips to CSV...');

                await sendMessageToTab(originalTabId, {
                    type: 'EXPORT_PRICE_TIPS_CSV',
                    priceData: priceData
                });

                // Reset base via API after price tips export
                try {
                    const stored = await chrome.storage.local.get(['originalBase', 'originalListingId', 'originalPms']);
                    const baseToRestore = stored.originalBase;
                    const listingId = stored.originalListingId;
                    const pms = stored.originalPms;
                    if (typeof baseToRestore === 'number' && listingId && pms && apiTokenGlobal) {
                        console.log('🔁 Restoring original base via API (after price tips):', { listingId, pms, baseToRestore });
                        await callPriceLabsListingsApi(listingId, pms, apiTokenGlobal, Math.floor(baseToRestore));
                        await persistLog('API: base restored', { listingId, pms, base: Math.floor(baseToRestore) });
                    } else {
                        console.warn('⚠️ Missing stored base/listing/pms/token; skipping API restore (after price tips)');
                        await persistLog('API: restore skipped - missing data', { hasBase: typeof baseToRestore === 'number', listingId, pms, hasToken: !!apiTokenGlobal });
                    }
                } catch (e) {
                    console.warn('Restore base via API (after price tips) failed', (e as Error)?.message);
                    await persistLog('API: restore failed', { error: (e as Error)?.message });
                }

                // Restore zoom after API call
                console.log('🔄 Restoring zoom after API call');
                await new Promise<void>((resolve, reject) => chrome.runtime.sendMessage({ type: 'zoom_restore' }, (resp) => {
                    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                    if (!resp?.ok) return reject(new Error(resp?.error || 'zoom_restore failed'));
                    resolve();
                }));
                await persistLog('Airbnb: zoom restored');

                await navigateBackToPriceLabsIfPairStored();

            } catch (airbnbError) {
                console.error('❌ Airbnb Price Tips workflow failed:', airbnbError);
                // Don't throw error - Airbnb workflow is optional
                console.log('⚠️ Continuing with success despite Airbnb workflow failure');
            } finally {
                // Zoom restoration now handled immediately after CSV export
                // No redundant zoom calls needed here
            }

            // Final success
            await updateState({
                status: WorkflowStatus.SUCCESS,
                message: `Full workflow completed successfully! PDF downloaded, navigated to Airbnb (same tab), scrolled calendar, and price tips extracted.`,
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

            // Step 22: Click Price Tips button
            await updateState({ step: 22, message: 'Airbnb Step 1: Clicking Price Tips button...' });
            console.log('🎯 Executing Price Tips button click...');

            const tab = await chrome.tabs.get(originalTabId);
            if (!tab.windowId) throw new Error("Tab does not have a windowId.");
            const originalWindow = await chrome.windows.get(tab.windowId);
            const originalZoom = await chrome.tabs.getZoom(originalTabId);

            try {
                await sendMessageToTab(originalTabId, { type: 'TOGGLE_PRICE_TIPS' });
                console.log('✅ Price Tips button clicked successfully');

                // Step 23: Zoom out and go fullscreen to see all months
                await updateState({ step: 23, message: 'Airbnb Step 2: Zooming out and entering fullscreen...' });
                console.log('🔍 Zooming out and entering fullscreen...');
                await zoomFull(originalTabId);
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for changes to apply

                // Step 24: Extract price tips data
                await updateState({ step: 24, message: 'Airbnb Step 3: Extracting price tips data...' });
                console.log('📊 Extracting price tips data...');

                const extractionResult = await sendMessageToTab(originalTabId, { type: 'EXTRACT_PRICE_TIPS' }) as any;
                const priceData = extractionResult.data || [];
                console.log(`✅ Extracted ${priceData.length} price tip entries`);

                // Step 25: Export to CSV
                await updateState({ step: 25, message: 'Airbnb Step 4: Exporting price tips to CSV...' });
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
            } finally {
                // Zoom restoration now handled immediately after CSV export
                // No redundant zoom calls needed here
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
    await persistLog('Workflow: resumeMarketResearchWorkflow started', { startStep });

    // If this is a fresh start (startStep = 18), we need to navigate to Airbnb first
    if (startStep === 18) {
        console.log('🛫 Fresh start: Navigating to Airbnb first...');
        await navigateToAirbnbMulticalendar();
    }

    try {
        // For fresh start (startStep=18), skip page checks since we just navigated to Airbnb
        if (startStep !== 18) {
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
        } else {
            console.log('🛫 Fresh start detected - skipping page checks, proceeding to Airbnb workflow');
        }
        
        // Continue with UI steps
        
        // For fresh start (startStep=18), skip to Airbnb workflow
        if (startStep === 18) {
            console.log('🛫 Fresh start: Jumping directly to Airbnb workflow');
            await proceedToAirbnbWorkflow();
            return; // Exit after Airbnb workflow completes
        }
        
        // Step 18: Click Show Dashboard (conditionally skip if starting later)
        if (startStep <= 18) {
            updateState({ step: 18, message: 'Market Research Step 4: Clicking Show Dashboard...' });
            try {
                await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_4_SHOW_DASHBOARD' });
            } catch (e) {
                console.log('⚠️ Show Dashboard click failed once, retrying after reinjection...', (e as Error)?.message);
                await injectScript(originalTabId!);
                await waitForTabLoad(originalTabId!);
                await new Promise(res => setTimeout(resolve, 2000));
                await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_4_SHOW_DASHBOARD' });
            }
        }
        
        // Step 19: Complete Show Dashboard workflow (with 12s wait)
        if (startStep <= 19) {
            updateState({ step: 19, message: 'Market Research Step 5: Waiting 12 seconds before PDF download...' });
            await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_5_COMPLETE' });
        }

        // Step 20: Download as PDF (with 15s wait)
        if (startStep <= 20) {
            updateState({ step: 20, message: 'Market Research Step 6: Downloading as PDF...' });
            await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_6_DOWNLOAD_PDF' });
        }

        // Step 21: Complete PDF download workflow
        if (startStep <= 21) {
            updateState({ step: 21, message: 'Market Research Step 7: Completing PDF download...' });
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

            // Step 22: Click Price Tips button
            updateState({ step: 22, message: 'Airbnb Step 1: Clicking Price Tips button...' });

            const tab = await chrome.tabs.get(originalTabId);
            if (!tab.windowId) throw new Error("Tab does not have a windowId.");
            const originalWindow = await chrome.windows.get(tab.windowId);
            const originalZoom = await chrome.tabs.getZoom(originalTabId);

            try {
                await sendMessageToTab(originalTabId, { type: 'TOGGLE_PRICE_TIPS' });

                // Step 23: Zoom out and go fullscreen to see all months
                await updateState({ step: 23, message: 'Airbnb Step 2: Zooming out and entering fullscreen...' });
                console.log('🔍 Zooming out and entering fullscreen...');
                await zoomFull(originalTabId);
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for changes to apply

                // Step 24: Extract price tips data
                updateState({ step: 24, message: 'Airbnb Step 3: Extracting price tips data...' });

                const extractionResult = await sendMessageToTab(originalTabId, { type: 'EXTRACT_PRICE_TIPS' }) as any;
                const priceData = extractionResult.data || [];

                // Step 25: Export to CSV
                updateState({ step: 25, message: 'Airbnb Step 4: Exporting price tips to CSV...' });

                await sendMessageToTab(originalTabId, {
                    type: 'EXPORT_PRICE_TIPS_CSV',
                    priceData: priceData
                });

                // Immediate logging after CSV export
                console.log('✅ CSV EXPORT COMPLETED - About to exit Airbnb workflow');
                await persistLog('Workflow: CSV export completed, exiting Airbnb workflow');

                // RESTORE ZOOM AND WINDOW STATE BEFORE CONTINUATION
                console.log('🔄 Restoring zoom and window state after price tips extraction...');
                await persistLog('Workflow: Restoring zoom and window state');
                try {
                    await zoomRestore(originalTabId);
                    console.log('✅ Zoom and window state restored successfully');
                    await persistLog('Workflow: Zoom and window state restored');
                } catch (zoomError) {
                    console.warn('⚠️ Failed to restore zoom/window state:', zoomError);
                    await persistLog('Workflow: Zoom restoration failed', { error: (zoomError as Error)?.message });
                }

                // EXECUTE CONTINUATION LOGIC IMMEDIATELY AFTER CSV EXPORT
                console.log('🔄 CONTINUATION: Starting post-Airbnb workflow...');
                console.log('🧾 PERSIST LOG TEST: Testing persistent logging...');
                await persistLog('Workflow: post-Airbnb continuation started');
                await persistLog('TEST: Persistent log test successful');

                // Reset base via API after price tips export
                console.log('🔄 CONTINUATION: Checking stored data for API restore...');
                try {
                    const stored = await chrome.storage.local.get(['originalBase', 'originalListingId', 'originalPms']);
                    console.log('🔄 CONTINUATION: Retrieved stored data:', {
                        hasBase: typeof stored.originalBase === 'number',
                        baseValue: stored.originalBase,
                        listingId: stored.originalListingId,
                        pms: stored.originalPms,
                        hasToken: !!apiTokenGlobal
                    });
                    await persistLog('Workflow: stored data check', {
                        hasBase: typeof stored.originalBase === 'number',
                        base: stored.originalBase,
                        listingId: stored.originalListingId,
                        pms: stored.originalPms,
                        hasToken: !!apiTokenGlobal
                    });

                    const baseToRestore = stored.originalBase;
                    const listingId = stored.originalListingId;
                    const pms = stored.originalPms;
                    if (typeof baseToRestore === 'number' && listingId && pms && apiTokenGlobal) {
                        console.log('🔁 CONTINUATION: Calling API to restore base price...');
                        await persistLog('Workflow: API restore starting', { listingId, pms, baseToRestore });
                        await callPriceLabsListingsApi(listingId, pms, apiTokenGlobal, Math.floor(baseToRestore));
                        console.log('✅ CONTINUATION: API restore completed');
                        await persistLog('Workflow: API restore completed', { listingId, pms, base: Math.floor(baseToRestore) });
                    } else {
                        console.warn('⚠️ CONTINUATION: Missing data for API restore');
                        await persistLog('Workflow: API restore skipped - missing data', {
                            hasBase: typeof baseToRestore === 'number',
                            listingId: !!listingId,
                            pms: !!pms,
                            hasToken: !!apiTokenGlobal
                        });
                    }
                } catch (e) {
                    console.warn('❌ CONTINUATION: API restore failed:', (e as Error)?.message);
                    await persistLog('Workflow: API restore error', { error: (e as Error)?.message });
                }

                // Navigate back to PriceLabs
                console.log('🔄 CONTINUATION: Starting navigation back to PriceLabs...');
                await persistLog('Workflow: navigation back starting');
                await navigateBackToPriceLabsIfPairStored();
                console.log('✅ CONTINUATION: Navigation back completed');
                await persistLog('Workflow: navigation back completed');

                // Mark workflow as successful
                console.log('🎉 WORKFLOW SUCCESS: About to mark as completed');
                await persistLog('Workflow: Success state reached');
                updateState({
                    status: WorkflowStatus.SUCCESS,
                    message: `Full workflow completed successfully! PDF downloaded, price tips extracted, base price restored, and returned to PriceLabs.`,
                });
                await clearWorkflowState();
                console.log('✅ WORKFLOW COMPLETED');
                await persistLog('Workflow: Final completion');

            } catch (airbnbError) {
                console.error('❌ Airbnb workflow failed:', airbnbError);
                await persistLog('Workflow: Airbnb workflow failed', { error: airbnbError?.message });
                console.error('❌ Airbnb Price Tips workflow failed:', airbnbError);
                // Don't throw error - Airbnb workflow is optional
                console.log('⚠️ Continuing with success despite Airbnb workflow failure');
            } finally {
                // Zoom restoration now handled immediately after CSV export
                // No redundant zoom calls needed here
            }
        }

        // Continue with API restore and navigation back after Airbnb workflow
        console.log('🔄 CONTINUATION: Starting post-Airbnb workflow...');
        console.log('🧾 PERSIST LOG TEST: Testing persistent logging...');
        await persistLog('Workflow: post-Airbnb continuation started');
        await persistLog('TEST: Persistent log test successful');

        // Reset base via API after price tips export
        console.log('🔄 CONTINUATION: Checking stored data for API restore...');
        try {
            const stored = await chrome.storage.local.get(['originalBase', 'originalListingId', 'originalPms']);
            console.log('🔄 CONTINUATION: Retrieved stored data:', {
                hasBase: typeof stored.originalBase === 'number',
                baseValue: stored.originalBase,
                listingId: stored.originalListingId,
                pms: stored.originalPms,
                hasToken: !!apiTokenGlobal
            });
            await persistLog('Workflow: stored data check', {
                hasBase: typeof stored.originalBase === 'number',
                base: stored.originalBase,
                listingId: stored.originalListingId,
                pms: stored.originalPms,
                hasToken: !!apiTokenGlobal
            });

            const baseToRestore = stored.originalBase;
            const listingId = stored.originalListingId;
            const pms = stored.originalPms;
            if (typeof baseToRestore === 'number' && listingId && pms && apiTokenGlobal) {
                console.log('🔁 CONTINUATION: Calling API to restore base price...');
                await persistLog('Workflow: API restore starting', { listingId, pms, baseToRestore });
                await callPriceLabsListingsApi(listingId, pms, apiTokenGlobal, Math.floor(baseToRestore));
                console.log('✅ CONTINUATION: API restore completed');
                await persistLog('Workflow: API restore completed', { listingId, pms, base: Math.floor(baseToRestore) });
            } else {
                console.warn('⚠️ CONTINUATION: Missing data for API restore');
                await persistLog('Workflow: API restore skipped - missing data', {
                    hasBase: typeof baseToRestore === 'number',
                    listingId: !!listingId,
                    pms: !!pms,
                    hasToken: !!apiTokenGlobal
                });
            }
        } catch (e) {
            console.warn('❌ CONTINUATION: API restore failed:', (e as Error)?.message);
            await persistLog('Workflow: API restore error', { error: (e as Error)?.message });
        }

        // Navigate back to PriceLabs
        console.log('🔄 CONTINUATION: Starting navigation back to PriceLabs...');
        await persistLog('Workflow: navigation back starting');
        await navigateBackToPriceLabsIfPairStored();
        console.log('✅ CONTINUATION: Navigation back completed');
        await persistLog('Workflow: navigation back completed');

        // COMPLETE FINAL STEPS ON PRICELABS
        console.log('🔄 CONTINUATION: Starting final PriceLabs steps...');
        await persistLog('Workflow: Starting final PriceLabs steps');

        try {
            // Step 1: Sync Now
            console.log('🔄 CONTINUATION: Clicking Sync Now...');
            await persistLog('Workflow: Clicking Sync Now');
            await sendMessageToTab(originalTabId, { type: 'SYNC_NOW' });
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Step 2: Edit
            console.log('🔄 CONTINUATION: Clicking Edit...');
            await persistLog('Workflow: Clicking Edit');
            await sendMessageToTab(originalTabId, { type: 'EDIT_BUTTON' });
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Step 3: Edit Now
            console.log('🔄 CONTINUATION: Clicking Edit Now...');
            await persistLog('Workflow: Clicking Edit Now');
            await sendMessageToTab(originalTabId, { type: 'EDIT_NOW' });
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Step 4: Edit Now (popup)
            console.log('🔄 CONTINUATION: Clicking Edit Now popup...');
            await persistLog('Workflow: Clicking Edit Now popup');
            await sendMessageToTab(originalTabId, { type: 'EDIT_NOW_POPUP' });
            await new Promise(resolve => setTimeout(resolve, 3000));

            console.log('✅ CONTINUATION: All final PriceLabs steps completed');
            await persistLog('Workflow: Final PriceLabs steps completed');

        } catch (finalStepsError) {
            console.warn('⚠️ CONTINUATION: Final PriceLabs steps failed:', finalStepsError);
            await persistLog('Workflow: Final PriceLabs steps failed', { error: (finalStepsError as Error)?.message });
            // Don't fail the entire workflow for these steps
        }

        // --- Success ---
        console.log('🎉 WORKFLOW SUCCESS: About to mark as completed');
        await persistLog('Workflow: Success state reached');
        updateState({
            status: WorkflowStatus.SUCCESS,
            message: `Full workflow completed successfully! PDF downloaded, price tips extracted, base price restored, final PriceLabs steps completed.`,
        });
        await clearWorkflowState();
        console.log('✅ WORKFLOW COMPLETED');
        await persistLog('Workflow: Final completion');

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
        // First inject JSZip library
        chrome.scripting.executeScript(
            {
                target: { tabId: tabId },
                files: ['lib/jszip.min.js'],
            },
            (jszipResults) => {
                if (chrome.runtime.lastError) {
                    console.warn('JSZip injection warning:', chrome.runtime.lastError.message);
                    // Continue anyway - not critical for basic functionality
                } else {
                    console.log('JSZip library injected successfully');
                }

                // Then inject content script
        chrome.scripting.executeScript(
            {
                target: { tabId: tabId },
                files: ['content.js'],
            },
                    (contentResults) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(`Failed to inject content script: ${chrome.runtime.lastError.message}`));
                        } else {
                            console.log('Content script injected successfully');
                resolve();
                        }
                    }
                );
            }
        );
    });
}

async function installNetworkLoggerInMainWorld(tabId: number): Promise<void> {
	try {
		await chrome.scripting.executeScript({
			target: { tabId, allFrames: true },
			// @ts-ignore
			world: 'MAIN',
			func: () => {
				// Avoid double-install
				if ((window as any).__pcpNetworkLoggerInstalled) return;
				(Object.assign(window as any, { __pcpNetworkLoggerInstalled: true }));
				const markSaveOk = (url: string, status: number) => {
					try {
						const savePattern = /\/pricing\/base\/save$/i;
						let path = '';
						try { path = new URL(url).pathname; } catch { path = url; }
						if (savePattern.test(path) && status >= 200 && status < 300) {
							(window as any).__pcpSaveOkAt = Date.now();
							(window as any).__pcpSaveOkUrl = url;
							console.log('✅ MAIN-WORLD: Save 2xx detected', { url, status, at: (window as any).__pcpSaveOkAt });
						}
					} catch {}
				};
				const origFetch = window.fetch;
				window.fetch = async (...args: any[]) => {
					let url = '';
					let method = 'GET';
					let bodyPreview = '';
					try {
						if (args[0] instanceof Request) {
							url = (args[0] as Request).url;
							method = (args[0] as Request).method || method;
							try { const clone = (args[0] as Request).clone(); bodyPreview = await clone.text(); if (bodyPreview.length > 500) bodyPreview = bodyPreview.slice(0, 500) + '…'; } catch {}
						} else {
							url = (args[0] && args[0].toString()) || '';
							if (args[1] && typeof args[1] === 'object') { method = (args[1] as any).method || method; const body = (args[1] as any).body; if (typeof body === 'string') bodyPreview = body.slice(0, 500); else if (body && typeof body === 'object') bodyPreview = `[${(body as any).constructor?.name}]`; }
						}
					} catch {}
					const start = Date.now();
					const res = await origFetch.apply(window, args as any);
					const dur = Date.now() - start;
					try { console.log('📡 FETCH', { method, url, status: (res as Response).status, ms: dur, bodyPreview }); } catch {}
					try { markSaveOk(url, (res as Response).status); } catch {}
					return res;
				};
				const origOpen = XMLHttpRequest.prototype.open;
				const origSend = XMLHttpRequest.prototype.send;
				XMLHttpRequest.prototype.open = function(method: string, url: string) { (this as any).__pcpUrl = url; (this as any).__pcpMethod = method; return origOpen.apply(this, arguments as any); } as any;
				XMLHttpRequest.prototype.send = function(body?: Document | BodyInit | null) {
					const xhr = this as any; const start = Date.now();
					xhr.addEventListener('loadend', function() {
						const dur = Date.now() - start; let bodyPreview = '';
						try { if (typeof body === 'string') bodyPreview = (body as string).slice(0, 500); else if (body && typeof body === 'object') bodyPreview = `[${(body as any).constructor?.name}]`; } catch {}
						try { console.log('📡 XHR', { method: xhr.__pcpMethod || '', url: xhr.__pcpUrl || '', status: xhr.status, ms: dur, bodyPreview }); } catch {}
						try { markSaveOk(xhr.__pcpUrl || '', xhr.status); } catch {}
					});
					return origSend.apply(this, arguments as any);
				} as any;
				console.log('✅ MAIN-WORLD: Network logger installed');
			}
		});
	} catch (e) {
		console.warn('Network logger install failed', e);
	}
}

async function waitForSave2xxInMainWorld(tabId: number, startTs: number, timeoutMs: number = 20000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await chrome.scripting.executeScript({
				target: { tabId, allFrames: true },
				// @ts-ignore
				world: 'MAIN',
				func: () => ({ at: (window as any).__pcpSaveOkAt || 0, url: (window as any).__pcpSaveOkUrl || '' })
			});
			const results = Array.isArray(res) ? res : (res ? [res] : []);
			for (const r of results as any[]) {
				const val = (r && (r as any).result) || { at: 0, url: '' };
				if (val.at && val.at > startTs) { console.log('✅ Save 2xx confirmed via MAIN world flag', val); return true; }
			}
		} catch {}
		await new Promise(r => setTimeout(r, 300));
	}
	console.warn('⌛ Timed out waiting for save 2xx confirmation');
	return false;
}

async function waitForSaveWithFallback(tabId: number, startTs: number, totalTimeoutMs: number = 20000): Promise<boolean> {
	const fastWindowMs = Math.min(2000, totalTimeoutMs);
	const t0 = Date.now();
	const okFast = await waitForSave2xxInMainWorld(tabId, startTs, fastWindowMs);
	if (okFast) return true;
	try { await clickSaveRefreshViaCDP(tabId); } catch {}
	const elapsed = Date.now() - t0;
	const remaining = Math.max(1000, totalTimeoutMs - elapsed);
	return await waitForSave2xxInMainWorld(tabId, startTs, remaining);
}

async function setBasePriceInMainWorld(tabId: number, delta: number): Promise<void> {
	console.log('🧠 MAIN-WORLD: Setting base price delta', delta);
	await chrome.scripting.executeScript({
		target: { tabId, allFrames: true },
		// @ts-ignore
		world: 'MAIN',
		args: [delta],
		func: (deltaArg: number) => {
			const log = (...args: any[]) => { try { console.log('🧠 MAIN-WORLD:setBasePrice', ...args); } catch {} };
			const toNum = (s: string) => { const n = parseFloat((s || '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : NaN; };
			const inputs = Array.from(document.querySelectorAll('input.chakra-numberinput__field')) as HTMLInputElement[];
			const withVals = inputs.map((el, idx) => ({ el, idx, val: toNum(el.value) })).filter(x => Number.isFinite(x.val) && x.val! > 0 && x.val! < 100000);
			log('found price inputs', withVals.map(x => ({ idx: x.idx, val: x.val })));
			if (withVals.length < 2) { log('not enough inputs to identify base'); return; }
			// Heuristic: three inputs [min, base, max] in DOM order => base is middle
			let base = withVals.length >= 3 ? withVals[1] : withVals[0];
			const input = base.el;
			const current = toNum(input.value) || 0;
			const rawTarget = current + (deltaArg || 0);
			const target = Math.round(rawTarget);
			const ownerWin = input.ownerDocument?.defaultView || window;
			const setter = Object.getOwnPropertyDescriptor(ownerWin.HTMLInputElement.prototype, 'value')?.set;
			input.scrollIntoView({ behavior: 'auto', block: 'center' });
			input.focus();
			// Select all then set via native setter
			input.dispatchEvent(new ownerWin.KeyboardEvent('keydown', { key: 'Control', bubbles: true }));
			input.dispatchEvent(new ownerWin.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
			input.dispatchEvent(new ownerWin.KeyboardEvent('keyup', { key: 'a', bubbles: true }));
			input.dispatchEvent(new ownerWin.KeyboardEvent('keyup', { key: 'Control', bubbles: true }));
			if (setter) setter.call(input, String(target)); else (input as any).value = String(target);
			input.dispatchEvent(new ownerWin.Event('input', { bubbles: true }));
			input.dispatchEvent(new ownerWin.Event('change', { bubbles: true }));
			// Nudge framework handlers
			input.dispatchEvent(new ownerWin.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
			input.dispatchEvent(new ownerWin.KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true }));
			input.dispatchEvent(new ownerWin.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
			input.dispatchEvent(new ownerWin.KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }));
			// Press Enter to commit in number input
			input.dispatchEvent(new ownerWin.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
			input.dispatchEvent(new ownerWin.KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
			input.blur();
			log('updated base from', current, 'to', target, '(raw target:', rawTarget, ')');
		}
	});
}

async function clickSaveRefreshInMainWorld(tabId: number): Promise<void> {
	console.log('🧠 MAIN-WORLD: Preparing to click Save & Refresh from main world');
	await chrome.scripting.executeScript({
		target: { tabId, allFrames: true },
		// @ts-ignore - world property supported in MV3
		world: 'MAIN',
		func: () => {
			const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
			const findButton = (): HTMLElement | null => {
				const byId = document.querySelector('button#rp-save-and-refresh') as HTMLElement | null;
				if (byId) return byId;
				const candidates = Array.from(document.querySelectorAll('button')) as HTMLElement[];
				return candidates.find(btn => {
					const t = (btn.textContent || '').toLowerCase();
					return t.includes('save') && (t.includes('refresh') || t.includes('&'));
				}) || null;
			};
			const pointerClick = (el: HTMLElement) => {
				const rect = el.getBoundingClientRect();
				const cx = rect.left + rect.width / 2;
				const cy = rect.top + rect.height / 2;
				const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0, buttons: 1 } as any;
				el.dispatchEvent(new (window as any).PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
				el.dispatchEvent(new MouseEvent('mousedown', opts));
				el.dispatchEvent(new MouseEvent('mouseup', opts));
				el.dispatchEvent(new MouseEvent('click', opts));
			};
			(async () => {
				const btn = findButton();
				if (!btn) {
					console.log('❌ MAIN-WORLD: Save & Refresh button not found');
					return;
				}
				console.log('🔍 MAIN-WORLD: Found Save & Refresh button', {
					id: (btn as HTMLButtonElement).id,
					disabled: (btn as HTMLButtonElement).disabled,
					hasDisabledAttr: btn.hasAttribute('disabled'),
					ariaDisabled: btn.getAttribute('aria-disabled'),
					dataLoading: btn.getAttribute('data-loading'),
					text: btn.textContent
				});
				let attempts = 60;
				while ((btn as HTMLButtonElement).disabled || btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true' || btn.getAttribute('data-loading') === 'true') {
					if (attempts-- <= 0) {
						console.warn('⌛ MAIN-WORLD: Timed out waiting for Save & Refresh to enable');
						break;
					}
					await sleep(250);
				}
				(btn as HTMLElement).scrollIntoView({ behavior: 'auto', block: 'center' });
				(btn as HTMLElement).focus();
				pointerClick(btn as HTMLElement);
				(btn as any).click && (btn as any).click();
				console.log('✅ MAIN-WORLD: Save & Refresh click dispatched');
			})();
		}
	});
}

async function readOneCalendarPriceInMainWorld(tabId: number): Promise<number | null> {
	try {
		const res = await chrome.scripting.executeScript({
			target: { tabId, allFrames: true },
			// @ts-ignore
			world: 'MAIN',
			func: () => {
				const cells = Array.from(document.querySelectorAll('[data-testid="calendar-cell"],[role="gridcell"]')) as HTMLElement[];
				const extract = (text: string): number | null => {
					const t = (text || '').trim();
					const cur = t.match(/[£$€]\s?([0-9]{2,4})/);
					if (cur) {
						const v = parseInt(cur[1], 10);
						if (Number.isFinite(v)) return v;
					}
					const nums = Array.from(t.matchAll(/\b([0-9]{2,4})\b/g)).map(m => parseInt(m[1], 10)).filter(n => Number.isFinite(n));
					const plausible = nums.filter(n => n >= 30 && n <= 5000);
					if (plausible.length > 0) return Math.max(...plausible);
					return null;
				};
				for (const c of cells) {
					const val = extract(c.textContent || '');
					if (val !== null) return val;
				}
				return null;
			}
		});
		const vals = (Array.isArray(res) ? res : [res]).map(r => (r as any)?.result).filter((v): v is number => typeof v === 'number');
		return vals.length ? vals[0] : null;
	} catch {
		return null;
	}
}

async function clickSaveRefreshViaCDP(tabId: number): Promise<void> {
	try {
		console.log('🖱️ CDP: Attempting Input.dispatchMouseEvent click on Save & Refresh');
		await new Promise<void>((resolve, reject) => {
			chrome.debugger.attach({ tabId }, '1.3', async () => {
				if (chrome.runtime.lastError) {
					console.warn('CDP attach failed', chrome.runtime.lastError.message);
					resolve();
					return;
				}
				const send = (method: string, params?: any) => new Promise<void>((res, rej) => chrome.debugger.sendCommand({ tabId }, method, params, () => {
					if (chrome.runtime.lastError) return rej(new Error(chrome.runtime.lastError.message));
					res();
				}));
				try {
					await send('DOM.enable');
					await send('Runtime.enable');
					const evalRes = await new Promise<any>((res) => chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: `(() => { const el = document.querySelector('button#rp-save-and-refresh') || Array.from(document.querySelectorAll('button')).find(b=>/save/i.test(b.textContent||'')&&/refresh|&/i.test(b.textContent||'')); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}; })()`, returnByValue: true }, (r) => res(r)));
					const point = evalRes?.result?.value;
					if (!point) {
						console.warn('CDP: Could not locate button center');
					} else {
						await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 });
						await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 });
						console.log('✅ CDP: Dispatched mouse click at', point);
					}
				} catch (e) {
					console.warn('CDP click failed', e);
				} finally {
					chrome.debugger.detach({ tabId }, () => resolve());
				}
			});
		});
	} catch (e) {
		console.warn('CDP click overall failed', e);
	}
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
    throw new Error('Full workflow resume not implemented for API mode.');
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
        await updateState({ status: WorkflowStatus.RUNNING, step: 1, message: 'Starting API workflow...' });
        // Extract listing and PMS and call API
        const { listingId, pms } = await extractListingParamsFromUrl(url);
        const token = apiTokenGlobal;
        if (!token) {
            throw new Error('API token is required. Please enter it in the popup.');
        }
        const computedBase = undefined; // no max from single-tab flow; pairs flow provides it
        await updateState({ step: 2, message: 'Calling PriceLabs Listings API...' });
        await callPriceLabsListingsApi(listingId, pms, token, computedBase);
        await updateState({ status: WorkflowStatus.SUCCESS, message: 'API call executed for current tab.' });
        await clearWorkflowState();
        return;

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

        // 1) GET current listing to store base/min/max, then POST to set base=max
        await updateState({ status: WorkflowStatus.RUNNING, step: 1, message: 'Step 1: Fetching current listing from API...' });
        const { listingId, pms } = await extractListingParamsFromUrl(priceLabsUrl);
        const token = apiTokenGlobal;
        if (!token) throw new Error('API token is required. Please enter it in the popup.');
        const current = await getListingViaApi(listingId, token);
        const maxFromApi = current?.max;
        console.log('📡 API GET current listing:', current);

        // Check if we already have the original base stored (don't overwrite it)
        const stored = await chrome.storage.local.get(['originalBase']);
        let originalBase: number;

        if (typeof stored.originalBase === 'number') {
            // Use the already stored original base (preserves the true original value)
            originalBase = stored.originalBase;
            console.log('✅ Using stored original base:', originalBase);
            await persistLog('Workflow: Using stored original base', { originalBase, currentBase: current?.base });
        } else {
            // Store the current base as the original (first time running workflow)
            originalBase = current?.base;
            console.log('📝 Storing new original base:', originalBase);
            await persistLog('Workflow: Storing new original base', { originalBase });
        }

        await chrome.storage.local.set({ originalBase, originalListingId: listingId, originalPms: pms });

        // 2) POST to set base to max
        await updateState({ step: 2, message: 'Step 2: Setting base to max via API...' });
        const computedBase = typeof maxFromApi === 'number' ? Math.floor(maxFromApi) : undefined;
        if (typeof computedBase === 'number') {
            await callPriceLabsListingsApi(listingId, pms, token, computedBase);
        } else {
            console.warn('⚠️ No max from API; skipping base set');
        }

        // 2) Navigate to PriceLabs AFTER the API call
        await updateState({ step: 3, message: 'Step 3: Navigating to PriceLabs URL...' });
        console.log('🌐 Navigating to PriceLabs URL:', priceLabsUrl);
        await chrome.tabs.update(originalTabId, { url: priceLabsUrl });
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Continue with the normal workflow from Dummy Sync (Step 3)
        await injectScript(originalTabId);
        await waitForTabLoad(originalTabId);
        await proceedAfterInitialSteps();
        return;

        // After CSV export in existing flow, navigate back handled elsewhere
    } catch (error) {
        console.error('❌ Error in startWorkflowWithPair:', error);
        await updateState({ status: WorkflowStatus.ERROR, message: error instanceof Error ? error.message : 'Unknown error' });
    }
}

async function proceedToAirbnbWorkflow() {
    console.log('🛫 Starting Airbnb workflow for fresh start...');

    try {
        // We're already on Airbnb from navigateToAirbnbMulticalendar()
        // So we can jump straight to the price tips workflow

        // Step 22: Click Price Tips button
        updateState({ step: 22, message: 'Airbnb Step 1: Clicking Price Tips button...' });

        const tab = await chrome.tabs.get(originalTabId);
        if (!tab.windowId) throw new Error("Tab does not have a windowId.");
        const originalWindow = await chrome.windows.get(tab.windowId);
        const originalZoom = await chrome.tabs.getZoom(originalTabId);

        try {
            await sendMessageToTab(originalTabId, { type: 'TOGGLE_PRICE_TIPS' });
            console.log('✅ Price Tips button clicked successfully');
            didAirbnbTips = true;
            await persistLog('Airbnb: Price Tips opened');

            // Step 23: Zoom out and go fullscreen to see all months
            await updateState({ step: 23, message: 'Airbnb Step 2: Zooming out and entering fullscreen...' });
            console.log('🔍 Zooming out and entering fullscreen...');
            await zoomFull(originalTabId);
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for changes to apply

            // Step 24: Extract price tips data
            updateState({ step: 24, message: 'Airbnb Step 3: Extracting price tips data...' });

            const extractionResult = await sendMessageToTab(originalTabId, { type: 'EXTRACT_PRICE_TIPS' }) as any;
            const priceData = extractionResult.data || [];

            // Step 25: Export to CSV
            updateState({ step: 25, message: 'Airbnb Step 4: Exporting price tips to CSV...' });

            await sendMessageToTab(originalTabId, {
                type: 'EXPORT_PRICE_TIPS_CSV',
                priceData: priceData
            });

            // Immediate logging after CSV export
            console.log('✅ CSV EXPORT COMPLETED - About to exit Airbnb workflow');
            await persistLog('Workflow: CSV export completed, exiting Airbnb workflow');

            // RESTORE ZOOM AND WINDOW STATE BEFORE CONTINUATION
            console.log('🔄 Restoring zoom and window state after price tips extraction...');
            await persistLog('Workflow: Restoring zoom and window state');
            try {
                await zoomRestore(originalTabId);
                console.log('✅ Zoom and window state restored successfully');
                await persistLog('Workflow: Zoom and window state restored');
            } catch (zoomError) {
                console.warn('⚠️ Failed to restore zoom/window state:', zoomError);
                await persistLog('Workflow: Zoom restoration failed', { error: (zoomError as Error)?.message });
            }

            // EXECUTE CONTINUATION LOGIC IMMEDIATELY AFTER CSV EXPORT
            console.log('🔄 CONTINUATION: Starting post-Airbnb workflow...');
            console.log('🧾 PERSIST LOG TEST: Testing persistent logging...');
            await persistLog('Workflow: post-Airbnb continuation started');
            await persistLog('TEST: Persistent log test successful');

            // Reset base via API after price tips export
            console.log('🔄 CONTINUATION: Checking stored data for API restore...');
            try {
                const stored = await chrome.storage.local.get(['originalBase', 'originalListingId', 'originalPms']);
                console.log('🔄 CONTINUATION: Retrieved stored data:', {
                    hasBase: typeof stored.originalBase === 'number',
                    baseValue: stored.originalBase,
                    listingId: stored.originalListingId,
                    pms: stored.originalPms,
                    hasToken: !!apiTokenGlobal
                });
                await persistLog('Workflow: stored data check', {
                    hasBase: typeof stored.originalBase === 'number',
                    base: stored.originalBase,
                    listingId: stored.originalListingId,
                    pms: stored.originalPms,
                    hasToken: !!apiTokenGlobal
                });

                const baseToRestore = stored.originalBase;
                const listingId = stored.originalListingId;
                const pms = stored.originalPms;
                if (typeof baseToRestore === 'number' && listingId && pms && apiTokenGlobal) {
                    console.log('🔁 CONTINUATION: Calling API to restore base price...');
                    await persistLog('Workflow: API restore starting', { listingId, pms, baseToRestore });
                    await callPriceLabsListingsApi(listingId, pms, apiTokenGlobal, Math.floor(baseToRestore));
                    console.log('✅ CONTINUATION: API restore completed');
                    await persistLog('Workflow: API restore completed', { listingId, pms, base: Math.floor(baseToRestore) });
                } else {
                    console.warn('⚠️ CONTINUATION: Missing data for API restore');
                    await persistLog('Workflow: API restore skipped - missing data', {
                        hasBase: typeof baseToRestore === 'number',
                        listingId: !!listingId,
                        pms: !!pms,
                        hasToken: !!apiTokenGlobal
                    });
                }
            } catch (e) {
                console.warn('❌ CONTINUATION: API restore failed:', (e as Error)?.message);
                await persistLog('Workflow: API restore error', { error: (e as Error)?.message });
            }

            // Navigate back to PriceLabs
            console.log('🔄 CONTINUATION: Starting navigation back to PriceLabs...');
            await persistLog('Workflow: navigation back starting');
            await navigateBackToPriceLabsIfPairStored();
            console.log('✅ CONTINUATION: Navigation back completed');
            await persistLog('Workflow: navigation back completed');

            // COMPLETE FINAL STEPS ON PRICELABS
            console.log('🔄 CONTINUATION: Starting final PriceLabs steps...');
            await persistLog('Workflow: Starting final PriceLabs steps');

            try {
                // Step 1: Sync Now
                console.log('🔄 CONTINUATION: Clicking Sync Now...');
                await persistLog('Workflow: Clicking Sync Now');
                await sendMessageToTab(originalTabId, { type: 'SYNC_NOW' });
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Step 2: Edit
                console.log('🔄 CONTINUATION: Clicking Edit...');
                await persistLog('Workflow: Clicking Edit');
                await sendMessageToTab(originalTabId, { type: 'EDIT_BUTTON' });
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Step 3: Edit Now
                console.log('🔄 CONTINUATION: Clicking Edit Now...');
                await persistLog('Workflow: Clicking Edit Now');
                await sendMessageToTab(originalTabId, { type: 'EDIT_NOW' });
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Step 4: Edit Now (popup)
                console.log('🔄 CONTINUATION: Clicking Edit Now popup...');
                await persistLog('Workflow: Clicking Edit Now popup');
                await sendMessageToTab(originalTabId, { type: 'EDIT_NOW_POPUP' });
                await new Promise(resolve => setTimeout(resolve, 3000));

                console.log('✅ CONTINUATION: All final PriceLabs steps completed');
                await persistLog('Workflow: Final PriceLabs steps completed');

            } catch (finalStepsError) {
                console.warn('⚠️ CONTINUATION: Final PriceLabs steps failed:', finalStepsError);
                await persistLog('Workflow: Final PriceLabs steps failed', { error: (finalStepsError as Error)?.message });
                // Don't fail the entire workflow for these steps
            }

            // Mark workflow as successful
            console.log('🎉 WORKFLOW SUCCESS: About to mark as completed');
            await persistLog('Workflow: Success state reached');
            updateState({
                status: WorkflowStatus.SUCCESS,
                message: `Full workflow completed successfully! PDF downloaded, price tips extracted, base price restored, final PriceLabs steps completed.`,
            });
            await clearWorkflowState();
            console.log('✅ WORKFLOW COMPLETED');
            await persistLog('Workflow: Final completion');

        } catch (airbnbError) {
            console.error('❌ Airbnb workflow failed:', airbnbError);
            await persistLog('Workflow: Airbnb workflow failed', { error: airbnbError?.message });
            console.error('❌ Airbnb Price Tips workflow failed:', airbnbError);
            // Don't throw error - Airbnb workflow is optional
            console.log('⚠️ Continuing with success despite Airbnb workflow failure');
        } finally {
            // Zoom restoration now handled immediately after CSV export
            // No redundant zoom calls needed here
        }
    } catch (error) {
        console.error("Market Research workflow error:", error);
        updateState({
            status: WorkflowStatus.ERROR,
            message: `Error at step ${state.step}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
    }
}

async function proceedAfterInitialSteps() {
    // Continue the workflow from where startWorkflowWithPair left off
    // startWorkflowWithPair completed steps 1-2, so we continue from step 3

    await updateState({ step: 3, message: 'Step 3: Clicking Sync Now button...' });
    await sendMessageToTab(originalTabId, { type: 'SYNC_NOW' });
    await new Promise(res => setTimeout(res, 3000));

    await updateState({ step: 4, message: 'Step 4: Clicking Edit button...' });
    await sendMessageToTab(originalTabId, { type: 'EDIT_BUTTON' });
    await new Promise(res => setTimeout(res, 3000));

    await updateState({ step: 5, message: 'Step 5: Clicking Edit Now button...' });
    await sendMessageToTab(originalTabId, { type: 'EDIT_NOW' });
    await new Promise(res => setTimeout(res, 3000));

    await updateState({ step: 6, message: 'Step 6: Clicking Download button...' });
    await sendMessageToTab(originalTabId, { type: 'OCCUPANCY_STEP_4_DOWNLOAD' });
    await new Promise(res => setTimeout(res, 3000));

    await updateState({ step: 7, message: 'Step 7: Closing popup...' });
    await sendMessageToTab(originalTabId, { type: 'OCCUPANCY_STEP_5_CLOSE_POPUP' });
    await new Promise(res => setTimeout(res, 3000));

    await updateState({ step: 8, message: 'Step 8: Clicking Dynamic Pricing dropdown...' });
    await sendMessageToTab(originalTabId, { type: 'NAVIGATION_STEP_1_DYNAMIC_PRICING' });
    await new Promise(res => setTimeout(res, 3000));

    // Step 9: Navigate to Customizations page
    await updateState({ step: 9, message: 'Step 9: Navigating to Customizations page...' });
    await sendMessageToTab(originalTabId, { type: 'NAVIGATION_STEP_2_CUSTOMIZATIONS' });
    await new Promise(res => setTimeout(res, 3000));

    // Wait for navigation to customizations page
    await new Promise(res => setTimeout(res, 5000));

    // Re-inject content script after navigation
    console.log('🔄 Re-injecting content script after Customizations navigation...');
    await injectScript(originalTabId);
    await waitForTabLoad(originalTabId);

    // Additional wait for React components to initialize
    console.log('🔄 Waiting for Customizations React components to initialize...');
    await new Promise(res => setTimeout(res, 5000));

    // Step 11: Select Listings tab
    await updateState({ step: 11, message: 'Customizations Step 1: Selecting Listings tab...' });
    await sendMessageToTab(originalTabId, { type: 'CUSTOMIZATIONS_STEP_1_LISTINGS' });
    await new Promise(res => setTimeout(res, 3000));

    // Step 12: Select Table View
    await updateState({ step: 12, message: 'Customizations Step 2: Selecting Table View...' });
    await sendMessageToTab(originalTabId, { type: 'CUSTOMIZATIONS_STEP_2_TABLE_VIEW' });
    await new Promise(res => setTimeout(res, 3000));

    // Step 13: Download Customizations
    await updateState({ step: 13, message: 'Customizations Step 3: Downloading customizations...' });
    await sendMessageToTab(originalTabId, { type: 'CUSTOMIZATIONS_STEP_3_DOWNLOAD_ALL' });
    await new Promise(res => setTimeout(res, 3000));

    // Step 14: Complete customizations
    await updateState({ step: 14, message: 'Customizations Step 4: Completing customizations...' });
    await sendMessageToTab(originalTabId, { type: 'CUSTOMIZATIONS_STEP_4_COMPLETE' });
    await new Promise(res => setTimeout(res, 3000));

    // Continue with Market Research workflow steps 15-24
    await updateState({ step: 15, message: 'Step 15: Clicking Market Research dropdown...' });
    await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_1_DROPDOWN' });
    await new Promise(res => setTimeout(res, 3000));

    await updateState({ step: 16, message: 'Step 16: Selecting Market Dashboard (navigation expected)...' });
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

    await updateState({ step: 17, message: 'Step 17: Completing navigation...' });
    await sendMessageToTab(originalTabId, { type: 'MARKET_RESEARCH_STEP_3_COMPLETE' });

    // Wait for Market Research page navigation (NO FORCED SCRIPT INJECTION)
    console.log('🔄 Waiting for Market Research page navigation...');
    await new Promise(res => setTimeout(res, 5000));

    // Continue with the Airbnb workflow and continuation logic
    await resumeMarketResearchWorkflow(18);
}

async function navigateBackToPriceLabsIfPairStored() {
    try {
        const result = await chrome.storage.local.get(['selectedPair']);
        const priceLabsUrl = result.selectedPair?.priceLabsUrl;
        if (!priceLabsUrl) {
            console.log('ℹ️ No stored PriceLabs URL to navigate back to.');
            return;
        }
		await persistLog('Nav: back to PriceLabs', { url: priceLabsUrl });
        await chrome.tabs.update(originalTabId, { url: priceLabsUrl, active: true });
        await new Promise(resolve => setTimeout(resolve, 3000));
        await injectScript(originalTabId);
        await waitForTabLoad(originalTabId);
		await persistLog('Nav: back complete');
    } catch (e) {
        console.error('Failed to navigate back to PriceLabs:', e);
    }
}

async function reduceBasePriceWorkflow() {
    // Manual reduction and Save/Refresh are removed in API mode.
    console.log('ℹ️ reduceBasePriceWorkflow skipped: manual UI steps replaced by API restore.');
}

async function getBasePriceFromContent(tabId: number): Promise<number | null> {
	try {
		const resp = await sendMessageToTab<{ type: 'BASE_PRICE_RESPONSE'; price: number }>(tabId, { type: 'GET_BASE_PRICE' } as any);
		return typeof (resp as any).price === 'number' ? (resp as any).price : null;
	} catch {
		return null;
	}
}

async function readServerBasePrice(tabId: number): Promise<number | null> {
	try {
		const resp = await sendMessageToTab<{ type: 'SERVER_BASE_PRICE_RESPONSE'; price: number | null }>(tabId, { type: 'READ_SERVER_BASE_PRICE' } as any);
		return (resp as any).price ?? null;
	} catch {
		return null;
	}
}

async function waitForBasePriceToPersist(tabId: number, expected: number, timeoutMs: number = 12000): Promise<boolean> {
	const start = Date.now();
	let last: number | null = null;
	while (Date.now() - start < timeoutMs) {
		last = await getBasePriceFromContent(tabId);
		console.log('🔎 Post-save base price readback:', last, 'expected:', expected);
		if (last === expected) return true;
		await new Promise(res => setTimeout(res, 1000));
	}
	console.warn('⌛ Base price did not match expected within timeout. Last seen:', last, 'expected:', expected);
	return false;
}

async function softRefreshIfMismatch(tabId: number, expected: number): Promise<void> {
	try {
		const server = await readServerBasePrice(tabId);
		const ui = await getBasePriceFromContent(tabId);
		console.log('🧰 Soft refresh check (UI vs Server vs Expected):', ui, server, expected);
		if (server === expected && ui !== expected) {
			console.log('🔄 UI mismatch with server, reloading tab to refresh UI...');
			await reloadAndReinject(tabId);
		}
	} catch (e) {
		console.warn('Soft refresh check failed', e);
	}
}

async function reloadAndReinject(tabId: number): Promise<void> {
	console.log('🔄 Reloading tab to refresh UI...');
	await new Promise<void>((resolve) => chrome.tabs.reload(tabId, { bypassCache: true }, () => resolve()));
	await new Promise(res => setTimeout(res, 5000));
	await injectScript(tabId);
	await waitForTabLoad(tabId);
	console.log('✅ UI reloaded and content script re-injected');
}

async function extractListingParamsFromUrl(url: string): Promise<{ listingId: string; pms: string }> {
	const u = new URL(url);
	const listingId = u.searchParams.get('listings') || '';
	const pms = u.searchParams.get('pms_name') || u.searchParams.get('pms') || '';
	if (!listingId || !pms) throw new Error(`Could not parse listingId/pms from URL: ${url}`);
	return { listingId, pms };
}

async function callPriceLabsListingsApi(listingId: string, pms: string, apiToken: string, base?: number): Promise<void> {
	console.log('📡 API: Preparing request', { listingId, pms, baseDefined: typeof base === 'number' });
	// Verify listing and current PMS/base first
	try {
		const getUrl = `https://api.pricelabs.co/v1/listings/${encodeURIComponent(listingId)}`;
		console.log('📡 API GET:', getUrl);
		const getRes = await fetch(getUrl, {
			method: 'GET',
			headers: {
				'X-API-Key': apiToken,
				'Content-Type': 'application/json'
			}
		});
		const getCt = getRes.headers.get('content-type') || '';
		const getText = await getRes.text();
		let getJson: any = null;
		try { if (getCt.includes('application/json')) getJson = JSON.parse(getText); } catch {}
		console.log('📡 API GET status:', getRes.status, 'ct:', getCt, 'json:', getJson ?? getText.slice(0, 400));
		if (!getRes.ok) {
			throw new Error(`GET /v1/listings/${listingId} failed: ${getRes.status} ${getText.slice(0, 400)}`);
		}
	} catch (e) {
		console.warn('⚠️ API GET verification failed (continuing to POST):', (e as Error)?.message);
	}

	const payload: any = { listings: [ { id: listingId, pms } ] };
	if (typeof base === 'number') payload.listings[0].base = base;
	const postUrl = 'https://api.pricelabs.co/v1/listings';
	console.log('📡 API POST: Setting base price...');
	console.log('📡 POST URL:', postUrl);
	console.log('📡 POST Payload:', JSON.stringify(payload, null, 2));
	const res = await fetch(postUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-API-Key': apiToken,
		},
		body: JSON.stringify(payload),
	});
	const ct = res.headers.get('content-type') || '';
	const text = await res.text();
	console.log('📡 POST Status:', res.status);
	console.log('📡 POST Response:', text.slice(0, 500));
	let json: any = null;
	try { if (ct.includes('application/json')) json = JSON.parse(text); } catch {}
	console.log('📡 POST Parsed JSON:', json);
	if (!res.ok) {
		console.error('❌ API POST failed:', res.status, text.slice(0, 400));
		await persistLog('API: POST failed', { status: res.status, error: text.slice(0, 400) });
		throw new Error(`API error ${res.status}: ${text.slice(0, 400)}`);
	}
	if (json && Array.isArray(json.listings)) {
		console.log('✅ API: update accepted for listings:', json.listings.map((l: any) => ({ id: l.id, pms: l.pms, base: l.base })));
		await persistLog('API: POST success', { listings: json.listings.map((l: any) => ({ id: l.id, pms: l.pms, base: l.base })) });
	}
}

async function getListingViaApi(listingId: string, apiToken: string): Promise<{ id: string; base?: number; min?: number; max?: number } | null> {
    const url = `https://api.pricelabs.co/v1/listings/${encodeURIComponent(listingId)}`;
    console.log('📡 API GET Step 1: Fetching listing details...');
    console.log('📡 GET URL:', url);
    const res = await fetch(url, { headers: { 'X-API-Key': apiToken } });
    const text = await res.text();
    console.log('📡 GET Status:', res.status);
    console.log('📡 GET Response:', text.slice(0, 500));

    if (!res.ok) {
        console.warn('❌ GET listing failed', res.status, text.slice(0, 200));
        await persistLog('API: GET failed', { status: res.status, error: text.slice(0, 200) });
        return null;
    }

    try {
        const json = JSON.parse(text);
        console.log('📡 GET Parsed JSON:', json);
        const lst = json?.listings?.[0];
        const result = lst ? { id: lst.id, base: lst.base, min: lst.min, max: lst.max } : null;
        console.log('📡 GET Extracted data:', result);
        await persistLog('API: GET success', { id: lst?.id, base: lst?.base, min: lst?.min, max: lst?.max });
        return result;
    } catch (e) {
        console.warn('❌ GET JSON parse failed:', e);
        await persistLog('API: GET parse failed', { error: (e as Error)?.message });
        return null;
    }
}
