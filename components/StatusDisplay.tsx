
import React from 'react';
import type { WorkflowState } from '../types';
import { WorkflowStatus } from '../types';

interface StatusDisplayProps {
  state: WorkflowState;
}

const getStatusColorClasses = (status: WorkflowStatus) => {
  switch (status) {
    case WorkflowStatus.RUNNING:
      return {
        icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
        iconColor: 'text-blue-400',
        textColor: 'text-blue-200',
        bgColor: 'bg-blue-900/50',
        progressColor: 'bg-blue-500',
      };
    case WorkflowStatus.SUCCESS:
      return {
        icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
        iconColor: 'text-green-400',
        textColor: 'text-green-200',
        bgColor: 'bg-green-900/50',
        progressColor: 'bg-green-500',
      };
    case WorkflowStatus.ERROR:
      return {
        icon: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
        iconColor: 'text-red-400',
        textColor: 'text-red-200',
        bgColor: 'bg-red-900/50',
        progressColor: 'bg-red-500',
      };
    default:
      return {
        icon: '',
        iconColor: '',
        textColor: '',
        bgColor: '',
        progressColor: '',
      };
  }
};

export const StatusDisplay: React.FC<StatusDisplayProps> = ({ state }) => {
  const { icon, iconColor, textColor, bgColor, progressColor } = getStatusColorClasses(state.status);
  const progressPercentage = state.status === WorkflowStatus.SUCCESS ? 100 : Math.max(0, (state.step / state.totalSteps) * 100);

  return (
    <div className={`p-4 rounded-lg ${bgColor}`}>
      <div className="flex items-center">
        <svg xmlns="http://www.w3.org/2000/svg" className={`h-8 w-8 ${iconColor} mr-3`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
        </svg>
        <div>
          <h3 className="font-bold text-lg capitalize">{state.status.toLowerCase()}</h3>
          {state.status === WorkflowStatus.RUNNING && (
            <p className="text-sm text-slate-400">Step {state.step} of {state.totalSteps}</p>
          )}
        </div>
      </div>
      <p className={`mt-3 ${textColor}`}>{state.message}</p>
      
      {state.status !== WorkflowStatus.IDLE && (
         <div className="w-full bg-slate-700 rounded-full h-2.5 mt-4">
            <div className={`${progressColor} h-2.5 rounded-full transition-all duration-500`} style={{ width: `${progressPercentage}%` }}></div>
        </div>
      )}
    </div>
  );
};
