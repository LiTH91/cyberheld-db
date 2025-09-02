import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cyberheld DB - Beweissicherung',
  description: 'Desktop-App zur Beweissicherung von Facebook-Kommentaren',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body className="bg-gray-50 min-h-screen">
        <div className="min-h-screen flex flex-col">
          <header className="bg-white shadow-sm border-b border-gray-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center py-4">
                <h1 className="text-2xl font-bold text-gray-900">
                  Cyberheld DB
                </h1>
                <p className="text-sm text-gray-500">
                  Beweissicherung für Facebook-Kommentare
                </p>
              </div>
            </div>
          </header>
          <main className="flex-1">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
