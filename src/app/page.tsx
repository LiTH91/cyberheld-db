'use client';

import { useState, useEffect } from 'react';
import { DocumentPlusIcon, FolderOpenIcon } from '@heroicons/react/24/outline';
import PostsList from '@/components/PostsList';
import type { Post } from '@/types/facebook';

export default function HomePage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    loadPosts();
  }, []);

  const loadPosts = async () => {
    try {
      setLoading(true);
      const response = await window.electronAPI.getPosts();
      if (response.success) {
        setPosts(response.posts);
      } else {
        console.error('Error loading posts:', response.error);
      }
    } catch (error) {
      console.error('Error loading posts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleImportJson = async () => {
    try {
      setImporting(true);
      
      // Open file dialog
      const filePath = await window.electronAPI.selectJsonFile();
      if (!filePath) return;

      // Import the JSON file
      const response = await window.electronAPI.importJson({ filePath });
      
      if (response.success) {
        alert(`Erfolgreich importiert!\nPost ID: ${response.postId}\nKommentare: ${response.commentsImported}`);
        await loadPosts(); // Refresh the posts list
      } else {
        alert(`Fehler beim Importieren: ${response.error}`);
      }
    } catch (error) {
      console.error('Error importing JSON:', error);
      alert(`Unerwarteter Fehler: ${error}`);
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-gray-500">Lade Posts...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">
              Posts Übersicht
            </h2>
            <p className="text-gray-600">
              Verwalte und durchsuche deine importierten Facebook-Posts
            </p>
          </div>
          
          <button
            onClick={handleImportJson}
            disabled={importing}
            className="btn-primary flex items-center gap-2"
          >
            {importing ? (
              <>
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                Importiere...
              </>
            ) : (
              <>
                <DocumentPlusIcon className="h-5 w-5" />
                JSON Importieren
              </>
            )}
          </button>
        </div>
      </div>

      {posts.length === 0 ? (
        <div className="text-center py-12">
          <FolderOpenIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">
            Keine Posts gefunden
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Importiere eine JSON-Datei, um zu beginnen.
          </p>
          <div className="mt-6">
            <button
              onClick={handleImportJson}
              disabled={importing}
              className="btn-primary"
            >
              Erste JSON-Datei importieren
            </button>
          </div>
        </div>
      ) : (
        <PostsList posts={posts} onRefresh={loadPosts} />
      )}
    </div>
  );
}
