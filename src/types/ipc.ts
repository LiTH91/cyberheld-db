import { FacebookComment, Post, Comment } from './facebook';

// IPC Channel Names
export const IPC_CHANNELS = {
  // Database operations
  GET_POSTS: 'db:get-posts',
  GET_COMMENTS: 'db:get-comments',
  IMPORT_JSON: 'db:import-json',
  
  // Screenshot operations
  TAKE_SCREENSHOT: 'screenshot:take',
  TAKE_SCREENSHOTS_BATCH: 'screenshot:take-batch',
  
  // File operations
  SELECT_JSON_FILE: 'file:select-json',
  OPEN_SCREENSHOT: 'file:open-screenshot',
} as const;

// IPC Message Types
export interface ImportJsonRequest {
  filePath: string;
}

export interface ImportJsonResponse {
  success: boolean;
  postId: string;
  commentsImported: number;
  error?: string;
}

export interface GetPostsResponse {
  success: boolean;
  posts: Post[];
  error?: string;
}

export interface GetCommentsRequest {
  postId: string;
}

export interface GetCommentsResponse {
  success: boolean;
  comments: Comment[];
  error?: string;
}

export interface TakeScreenshotRequest {
  commentId: string;
  commentUrl: string;
  postId: string;
}

export interface TakeScreenshotResponse {
  success: boolean;
  screenshotPath?: string;
  error?: string;
}

export interface TakeScreenshotsBatchRequest {
  postId: string;
  comments: Array<{
    id: string;
    url: string;
  }>;
}

export interface TakeScreenshotsBatchResponse {
  success: boolean;
  completed: number;
  failed: number;
  errors: Array<{
    commentId: string;
    error: string;
  }>;
}
