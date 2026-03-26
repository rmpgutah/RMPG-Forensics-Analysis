import React from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  icon,
  actions,
}) => {
  return (
    <div className="mb-6 border-b border-slate-700 pb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {icon && <span className="text-blue-400">{icon}</span>}
          <div>
            <h1 className="text-2xl font-bold text-white">{title}</h1>
            {description && (
              <p className="mt-1 text-sm text-slate-400">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
};
