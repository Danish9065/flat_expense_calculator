import React from 'react';
import { Link } from 'react-router-dom';
import { Compass, ArrowLeft } from 'lucide-react';

export default function NotFound() {
    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
            <div className="w-24 h-24 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-6">
                <Compass className="w-12 h-12" />
            </div>

            <h1 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight mb-2">
                404
            </h1>
            <h2 className="text-xl font-bold text-gray-700 dark:text-gray-200 mb-4">
                Page Not Found
            </h2>
            <p className="text-gray-500 dark:text-gray-400 max-w-xs mb-8">
                We couldn't locate the page you're trying to reach. It might have been moved or doesn't exist.
            </p>

            <Link
                to="/dashboard"
                className="flex items-center px-6 py-3 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-colors shadow-sm"
            >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
            </Link>
        </div>
    );
}
