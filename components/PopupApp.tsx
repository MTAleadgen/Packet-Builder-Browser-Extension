import React, { useState, useEffect, useCallback } from 'react';
import type { WorkflowState, Message, LinkPair } from '../types';
import { WorkflowStatus } from '../types';
import { StatusDisplay } from './StatusDisplay';

// FIX: Use a global declaration for 'chrome' to resolve TypeScript errors when @types/chrome is not available.
declare const chrome: any;

const initialState: WorkflowState = {
  status: WorkflowStatus.IDLE,
  message: 'Ready to start.',
  step: 0,
  totalSteps: 9,
};

export const PopupApp: React.FC = () => {
  const [workflowState, setWorkflowState] = useState<WorkflowState>(initialState);
  const [isPriceLabsPage, setIsPriceLabsPage] = useState<boolean>(false);
  const [isCustomizationPage, setIsCustomizationPage] = useState<boolean>(false);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [pairs, setPairs] = useState<LinkPair[]>([{
    priceLabsUrl: 'https://app.pricelabs.co/pricing?listings=1317460106754094447&pms_name=airbnb&open_calendar=true',
    airbnbUrl: 'https://www.airbnb.com/multicalendar/1317460106754094447'
  }]);
  const [selectedIndexes, setSelectedIndexes] = useState<Record<number, boolean>>({ 0: true });
  const [isPairsMode, setIsPairsMode] = useState<boolean>(false);
  const [apiToken, setApiToken] = useState<string>('');

  useEffect(() => {

    // Check if on a valid PriceLabs page
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      const url = currentTab?.url ?? '';

      console.log('🔍 POPUP DEBUG: Current URL:', url);
      console.log('🔍 POPUP DEBUG: Tab ID:', currentTab?.id);
      console.log('🔍 POPUP DEBUG: Tab title:', currentTab?.title);

      setCurrentUrl(url);

      const isPricingPage = url.includes('app.pricelabs.co/pricing?listings=');
      const isCustomPage = url.includes('app.pricelabs.co/customization');
      const isReportsPage = url.includes('app.pricelabs.co/reports');

      // Also check if we're on a PriceLabs domain but potentially redirected to login
      const isPriceLabsDomain = url.includes('app.pricelabs.co');
      const isLoginPage = url.includes('/login') || currentTab?.title?.toLowerCase().includes('login');

      console.log('🔍 POPUP DEBUG: Domain check:', { isPriceLabsDomain, isLoginPage });
      console.log('🔍 POPUP DEBUG: URL Analysis:', { isPricingPage, isCustomPage, isReportsPage });

      if (isPricingPage || isCustomPage || isReportsPage) {
        setIsPriceLabsPage(true);
        console.log('✅ POPUP DEBUG: Valid PriceLabs page detected');
      } else if (isPriceLabsDomain && isLoginPage) {
        // Special case: on PriceLabs domain but redirected to login
        setIsPriceLabsPage(false); // Don't show buttons, but show special message
        console.log('⚠️ POPUP DEBUG: On PriceLabs domain but redirected to login page');
      } else {
        console.log('❌ POPUP DEBUG: Not a valid PriceLabs page');
      }

      if (isCustomPage) {
        setIsCustomizationPage(true);
        console.log('✅ POPUP DEBUG: Customization page - Resume Customizations button enabled');
      }

      if (isReportsPage) {
        setIsCustomizationPage(true); // Reuse the same state for showing resume button
        console.log('✅ POPUP DEBUG: Reports page - Resume Market Research button enabled');
      }

      setIsLoading(false);
      console.log('🔄 POPUP DEBUG: PopupApp initialization complete');
    });

    // Request current state from background script on popup open
    chrome.runtime.sendMessage({ type: 'GET_WORKFLOW_STATE' });

    // Listener for state updates from background script
    const messageListener = (message: Message) => {
      console.log('📨 POPUP DEBUG: Received message:', message.type);
      if (message.type === 'WORKFLOW_STATE_UPDATE') {
        console.log('📊 POPUP DEBUG: Workflow state:', message.payload.status, 'Step:', message.payload.step + '/' + message.payload.totalSteps);
        console.log('💬 POPUP DEBUG: Message:', message.payload.message);
        setWorkflowState(message.payload);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    console.log('📨 POPUP DEBUG: Message listener registered');

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []); // Remove addLog from dependencies to prevent infinite loop

  const handleStart = useCallback(() => {
    console.log('🚀 POPUP DEBUG: Start Full Workflow button clicked');
    chrome.runtime.sendMessage({ type: 'START_GATHERING' });
  }, []);

  const handleCancel = useCallback(() => {
    console.log('🛑 POPUP DEBUG: Cancel button clicked');
    chrome.runtime.sendMessage({ type: 'CANCEL_GATHERING' });
  }, []);

  const handleReset = useCallback(() => {
    console.log('🔄 POPUP DEBUG: Reset button clicked');
    chrome.runtime.sendMessage({ type: 'RESET_WORKFLOW' });
  }, []);



  const addPair = useCallback(() => {
    setPairs(prev => ([...prev, { priceLabsUrl: '', airbnbUrl: '' }]));
  }, []);

  const updatePair = useCallback((index: number, field: keyof LinkPair, value: string) => {
    setPairs(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
  }, []);

  const toggleSelected = useCallback((index: number) => {
    setSelectedIndexes(prev => ({ ...prev, [index]: !prev[index] }));
  }, []);

  const handleStartPairs = useCallback(() => {
    const selectedPairs = pairs.filter((_, idx) => !!selectedIndexes[idx]);
    console.log('🚀 POPUP DEBUG: Start with pairs clicked. Selected:', selectedPairs);
    chrome.runtime.sendMessage({ type: 'START_WORKFLOW_WITH_PAIRS', selectedPairs });
  }, [pairs, selectedIndexes]);

  const renderContent = () => {
    if (isLoading) {
      return <div className="text-center p-4">Loading...</div>;
    }
    
    // Check if we have selected pairs for navigation
    const hasSelectedPairs = pairs.some((_, idx) => !!selectedIndexes[idx] && pairs[idx].priceLabsUrl);

    if (!isPriceLabsPage && workflowState.status === WorkflowStatus.IDLE && !hasSelectedPairs) {
      // Check if we're on PriceLabs domain but redirected to login
      const isPriceLabsDomain = currentUrl.includes('app.pricelabs.co');
      const isLoginPage = currentUrl.includes('/login') || currentUrl.includes('login');
      
      if (isPriceLabsDomain && isLoginPage) {
        return (
          <div className="text-center p-4 bg-red-900/50 rounded-lg m-4">
            <h3 className="font-bold text-lg text-red-300">Login Required</h3>
            <p className="text-red-100 mt-2">You've been redirected to the login page. Please log in to PriceLabs first.</p>
            <p className="text-xs text-red-200/60 mt-2">After logging in, navigate to the desired page and reopen this extension.</p>
            <div className="mt-2 text-xs text-red-200">
              Open browser console (F12) for detailed logs
            </div>
          </div>
        );
      }
      
      return (
        <div className="text-center p-4 bg-yellow-900/50 rounded-lg m-4">
          <h3 className="font-bold text-lg text-yellow-300">Action Required</h3>
          <p className="text-yellow-100 mt-2">Please navigate to a PriceLabs listing calendar page to begin.</p>
          <p className="text-xs text-yellow-200/60 mt-2">(URL should contain app.pricelabs.co/pricing?listings=, app.pricelabs.co/customization, or app.pricelabs.co/reports)</p>
          <div className="mt-2 text-xs text-yellow-200">
            Open browser console (F12) for detailed logs
          </div>
        </div>
      );
    }

    switch (workflowState.status) {
      case WorkflowStatus.IDLE:        
        return (
          <div className="space-y-3">
            <div className="space-y-3">
              <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
                <div className="text-sm font-semibold mb-2">API Settings</div>
                <input
                  type="password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder="PriceLabs API Token"
                  className="w-full mb-3 px-2 py-1 text-xs bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <div className="text-sm font-semibold mb-2">Link Pairs</div>
                <div className="text-xs text-gray-400 mb-2">System will automatically navigate to PriceLabs first</div>
                {pairs.map((pair, idx) => (
                  <div key={idx} className="grid grid-cols-[20px,1fr] gap-2 mb-2 items-start">
                    <input type="checkbox" checked={!!selectedIndexes[idx]} onChange={() => toggleSelected(idx)} />
                    <div className="space-y-1">
                      <input
                        type="text"
                        value={pair.priceLabsUrl}
                        onChange={(e) => updatePair(idx, 'priceLabsUrl', e.target.value)}
                        placeholder="PriceLabs URL"
                        className="w-full px-2 py-1 text-xs bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <input
                        type="text"
                        value={pair.airbnbUrl}
                        onChange={(e) => updatePair(idx, 'airbnbUrl', e.target.value)}
                        placeholder="Airbnb Multicalendar URL"
                        className="w-full px-2 py-1 text-xs bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      {/* Max price input removed; we use max from API GET */}
                    </div>
                  </div>
                ))}
                <button onClick={addPair} className="w-full bg-gray-700 hover:bg-gray-600 text-white text-xs py-1 px-2 rounded">+ Add Pair</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    const selectedPairs = pairs.filter((_, idx) => !!selectedIndexes[idx]);
                    console.log('🚀 POPUP DEBUG: Start with pairs clicked. Selected:', selectedPairs);
                    chrome.runtime.sendMessage({ type: 'START_WORKFLOW_WITH_PAIRS', selectedPairs, apiToken });
                  }}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-lg transition-all duration-300 shadow-lg"
                >
                  Start With Selected Pairs (Auto-Navigate)
                </button>
                <button
                  onClick={handleStart}
                  className="w-full bg-slate-600 hover:bg-slate-500 text-white font-bold py-3 px-4 rounded-lg transition-all duration-300 shadow-lg"
                >
                  Start Full Workflow (Current Tab)
                </button>
              </div>
            </div>
            {isCustomizationPage && (
              <>
                <button
                  onClick={() => {
                    const isReports = currentUrl.includes('app.pricelabs.co/reports');
                    const fromStep = isReports ? 21 : 14;
                    const customizationsOnly = false; // Full workflow
                    const buttonType = isReports ? 'Resume Market Research' : 'Continue Full Workflow';
                    console.log(`🔄 POPUP DEBUG: ${buttonType} button clicked (fromStep: ${fromStep}, customizationsOnly: ${customizationsOnly})`);
                    console.log(`📍 POPUP DEBUG: Current URL for resume: ${currentUrl}`);
                    chrome.runtime.sendMessage({ type: 'RESUME_WORKFLOW', fromStep: fromStep, customizationsOnly: customizationsOnly });
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded-lg transition-all duration-300 shadow-lg"
                >
                  {currentUrl.includes('app.pricelabs.co/reports') ? 'Resume Market Research' : 'Continue Full Workflow'}
                </button>
                {!currentUrl.includes('app.pricelabs.co/reports') && (
                  <button
                    onClick={() => {
                      const fromStep = 14;
                      const customizationsOnly = true; // Customizations only
                      console.log(`🔄 POPUP DEBUG: Resume Customizations Only button clicked (fromStep: ${fromStep}, customizationsOnly: ${customizationsOnly})`);
                      console.log(`📍 POPUP DEBUG: Current URL for resume: ${currentUrl}`);
                      chrome.runtime.sendMessage({ type: 'RESUME_WORKFLOW', fromStep: fromStep, customizationsOnly: customizationsOnly });
                    }}
                    className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-4 rounded-lg transition-all duration-300 shadow-lg"
                  >
                    Resume Customizations Only
                  </button>
                )}
              </>
            )}
            <div className="text-xs text-gray-400 mt-2">
              URL: {currentUrl}
              <br />
              Customization Page: {isCustomizationPage ? '✅ Yes' : '❌ No'}
            </div>

          </div>
        );
      case WorkflowStatus.RUNNING:
        return (
          <div className="flex flex-col h-full">
            <StatusDisplay state={workflowState} />
            <button
              onClick={handleCancel}
              className="mt-auto w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-4 rounded-lg transition-all duration-300"
            >
              Cancel
            </button>
          </div>
        );
      case WorkflowStatus.SUCCESS:
        return (
          <div className="text-center">
            <StatusDisplay state={workflowState} />
            <button
              onClick={handleReset}
              className="mt-4 w-full bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 px-4 rounded-lg transition-all duration-300"
            >
              Start Over
            </button>
          </div>
        );
      case WorkflowStatus.ERROR:
        return (
          <div className="text-center">
            <StatusDisplay state={workflowState} />
              <button
                onClick={handleReset}
                className="mt-4 w-full bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 px-4 rounded-lg transition-all duration-300"
              >
                Try Again
              </button>
              <div className="mt-2 text-xs text-red-200">
                Open browser console (F12) for detailed error logs
              </div>
            </div>
          );
    }
  };

  return (
    <div className="flex flex-col p-4 h-full bg-slate-800/50 rounded-lg">
      <header className="flex items-center pb-4 border-b border-slate-700">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-indigo-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a1 1 0 001 1h1.586l.707.707a1 1 0 001.414 0L8.414 14H15a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1-1zm1 2v8h10V5H4z" clipRule="evenodd" />
          <path d="M11 7a1 1 0 10-2 0v4a1 1 0 102 0V7zM7 9a1 1 0 10-2 0v2a1 1 0 102 0V9zM15 9a1 1 0 10-2 0v2a1 1 0 102 0V9z" />
        </svg>
        <h1 className="text-xl font-bold ml-2">Pricing Co-Pilot</h1>
      </header>
      <main className="flex-grow pt-4 flex flex-col justify-center">
        {renderContent()}
      </main>
    </div>
  );
};