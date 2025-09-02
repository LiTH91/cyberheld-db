'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarIcon, ChatBubbleLeftIcon, EyeIcon } from '@heroicons/react/24/outline';
import type { Post } from '@/types/facebook';

interface PostsListProps {
  posts: Post[];
  onRefresh: () => void;
}

export default function PostsList({ posts, onRefresh }: PostsListProps) {
  const [selectedPost, setSelectedPost] = useState<string | null>(null);
  const router = useRouter();

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('de-DE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleViewComments = (postId: string) => {
    setSelectedPost(postId);
    router.push(`/posts/${encodeURIComponent(postId)}`);
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          Importierte Posts ({posts.length})
        </h3>
        
        {posts.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            Keine Posts vorhanden
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-header">Titel</th>
                  <th className="table-header">Datei</th>
                  <th className="table-header">Importiert</th>
                  <th className="table-header">Kommentare</th>
                  <th className="table-header">Aktionen</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {posts.map((post) => {
                  const metadata = JSON.parse(post.metadata);
                  return (
                    <tr key={post.id} className="hover:bg-gray-50">
                      <td className="table-cell">
                        <div className="max-w-xs">
                          <p className="font-medium text-gray-900 truncate">
                            {post.title}
                          </p>
                          <p className="text-gray-500 text-xs truncate">
                            {post.url}
                          </p>
                        </div>
                      </td>
                      <td className="table-cell">
                        <span className="text-sm text-gray-600">
                          {post.filename}
                        </span>
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center text-sm text-gray-500">
                          <CalendarIcon className="h-4 w-4 mr-1" />
                          {formatDate(post.timestamp_captured)}
                        </div>
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center text-sm text-gray-600">
                          <ChatBubbleLeftIcon className="h-4 w-4 mr-1" />
                          {metadata.totalComments || 0}
                        </div>
                      </td>
                      <td className="table-cell">
                        <button
                          onClick={() => handleViewComments(post.id)}
                          className="btn-secondary text-sm flex items-center gap-1"
                        >
                          <EyeIcon className="h-4 w-4" />
                          Anzeigen
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
