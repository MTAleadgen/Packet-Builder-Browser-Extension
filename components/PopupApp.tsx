import React, { useState, useEffect, useCallback } from 'react';
import type { WorkflowState, Message } from '../types';
import { WorkflowStatus } from '../types';
import { StatusDisplay } from './StatusDisplay';

// FIX: Use a global declaration for 'chrome' to resolve TypeScript errors when @types/chrome is not available.
declare const chrome: any;

const initialState: WorkflowState = {
  status: WorkflowStatus.IDLE,
  message: 'Ready to start.',
  step: 0,
  totalSteps: 7,
};

export const PopupApp: React.FC = () => {
  const [workflowState, setWorkflowState] = useState<WorkflowState>(initialState);
  const [isPriceLabsPage, setIsPriceLabsPage] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    // Check if on a valid PriceLabs page
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      if (currentTab?.url?.startsWith('https://app.pricelabs.co/listing/')) {
        setIsPriceLabsPage(true);
      }
      setIsLoading(false);
    });

    // Request current state from background script on popup open
    chrome.runtime.sendMessage({ type: 'GET_WORKFLOW_STATE' });

    // Listener for state updates from background script
    const messageListener = (message: Message) => {
      if (message.type === 'WORKFLOW_STATE_UPDATE') {
        setWorkflowState(message.payload);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  const handleStart = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'START_GATHERING' });
  }, []);

  const handleCancel = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'CANCEL_GATHERING' });
  }, []);

  const handleReset = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'RESET_WORKFLOW' });
  }, []);

  const renderContent = () => {
    if (isLoading) {
      return <div className="text-center p-4">Loading...</div>;
    }
    
    if (!isPriceLabsPage && workflowState.status === WorkflowStatus.IDLE) {
      return (
        <div className="text-center p-4 bg-yellow-900/50 rounded-lg m-4">
          <h3 className="font-bold text-lg text-yellow-300">Action Required</h3>
          <p className="text-yellow-100 mt-2">Please navigate to a PriceLabs listing calendar page to begin.</p>
          <p className="text-xs text-yellow-200/60 mt-2">(URL should start with https://app.pricelabs.co/listing/...)</p>
        </div>
      );
    }

    switch (workflowState.status) {
      case WorkflowStatus.IDLE:
        return (
          <button
            onClick={handleStart}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 px-4 rounded-lg transition-all duration-300 shadow-lg"
          >
            Start Weekly Data Gathering
          </button>
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