
export enum WorkflowStatus {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
}

export interface WorkflowState {
  status: WorkflowStatus;
  message: string;
  step: number;
  totalSteps: number;
}

export interface LinkPair {
  priceLabsUrl: string;
  airbnbUrl: string;
}

export type Message = 
  | { type: 'START_GATHERING' }
  | { type: 'START_WORKFLOW_WITH_PAIRS', selectedPairs: LinkPair[], apiToken?: string }
  | { type: 'CANCEL_GATHERING' }
  | { type: 'RESET_WORKFLOW' }
  | { type: 'GET_WORKFLOW_STATE' }
  | { type: 'RESUME_WORKFLOW', fromStep?: number, customizationsOnly?: boolean }
  | { type: 'WORKFLOW_STATE_UPDATE', payload: WorkflowState };

export type ContentScriptMessage =
  | { type: 'GET_BASE_PRICE' }
  | { type: 'SET_BASE_PRICE', price: number }
  | { type: 'CLICK_SAVE_REFRESH' }
  | { type: 'CLICK_SYNC_NOW' }
  | { type: 'OCCUPANCY_STEP_1_EDIT' }
  | { type: 'OCCUPANCY_STEP_2_SCROLL_FIND_EDIT_PROFILE' }
  | { type: 'OCCUPANCY_STEP_3_CONFIRM_EDIT' }
  | { type: 'OCCUPANCY_STEP_4_DOWNLOAD' }
  | { type: 'OCCUPANCY_STEP_5_CLOSE_POPUP' }
  | { type: 'OCCUPANCY_STEP_6_COMPLETE' }
  | { type: 'NAVIGATION_STEP_1_DYNAMIC_PRICING' }
  | { type: 'NAVIGATION_STEP_2_CUSTOMIZATIONS' }
  | { type: 'NAVIGATION_STEP_3_COMPLETE' }
  | { type: 'CUSTOMIZATIONS_STEP_1_LISTINGS' }
  | { type: 'CUSTOMIZATIONS_STEP_2_TABLE_VIEW' }
  | { type: 'CUSTOMIZATIONS_STEP_3_DOWNLOAD_ALL' }
  | { type: 'CUSTOMIZATIONS_STEP_4_COMPLETE' }
  | { type: 'MARKET_RESEARCH_STEP_1_DROPDOWN' }
  | { type: 'MARKET_RESEARCH_STEP_2_MARKET_DASHBOARD' }
  | { type: 'MARKET_RESEARCH_STEP_3_COMPLETE' }
  | { type: 'MARKET_RESEARCH_STEP_4_SHOW_DASHBOARD' }
  | { type: 'MARKET_RESEARCH_STEP_5_COMPLETE' }
  | { type: 'MARKET_RESEARCH_STEP_6_DOWNLOAD_PDF' }
  | { type: 'MARKET_RESEARCH_STEP_7_COMPLETE' }
  | { type: 'CLICK_ELEMENT', selector: string }
  | { type: 'WAIT_FOR_ELEMENT_TO_DISAPPEAR', selector: string, timeout?: number }
  | { type: 'WAIT_FOR_ELEMENT', selector: string, timeout?: number }
  | { type: 'SELECT_AIRBNB_LISTING', listingName: string } // Example, adapt as needed
  | { type: 'TOGGLE_PRICE_TIPS' }
  | { type: 'READ_SERVER_BASE_PRICE' }
  | { type: 'SNAPSHOT_CALENDAR_PRICES' }
  | { type: 'CHECK_CALENDAR_UPDATED' }
  | { type: 'FORCE_CALENDAR_RERENDER' };

export type ContentScriptResponse =
  | { type: 'SUCCESS' }
  | { type: 'ERROR', message: string }
  | { type: 'BASE_PRICE_RESPONSE', price: number }
  | { type: 'SERVER_BASE_PRICE_RESPONSE', price: number | null }
  | { type: 'CALENDAR_UPDATED_RESPONSE', changed: boolean };
