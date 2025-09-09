
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

export type Message = 
  | { type: 'START_GATHERING' }
  | { type: 'CANCEL_GATHERING' }
  | { type: 'RESET_WORKFLOW' }
  | { type: 'GET_WORKFLOW_STATE' }
  | { type: 'WORKFLOW_STATE_UPDATE', payload: WorkflowState };

export type ContentScriptMessage =
  | { type: 'GET_BASE_PRICE' }
  | { type: 'SET_BASE_PRICE', price: number }
  | { type: 'CLICK_ELEMENT', selector: string }
  | { type: 'WAIT_FOR_ELEMENT_TO_DISAPPEAR', selector: string }
  | { type: 'WAIT_FOR_ELEMENT', selector: string }
  | { type: 'SELECT_AIRBNB_LISTING', listingName: string } // Example, adapt as needed
  | { type: 'TOGGLE_PRICE_TIPS' };

export type ContentScriptResponse =
  | { type: 'SUCCESS' }
  | { type: 'ERROR', message: string }
  | { type: 'BASE_PRICE_RESPONSE', price: number };
