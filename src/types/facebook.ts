export interface FacebookComment {
  facebookUrl: string;
  commentUrl: string;
  id: string;
  feedbackId: string;
  date: string;
  text: string;
  attachments?: Array<{
    __typename: string;
    blurred_image?: {
      uri: string;
    };
    id: string;
    cix_screen?: any;
    massive_image?: {
      width: number;
      height: number;
    };
    image?: {
      uri: string;
      width: number;
      height: number;
    };
    ocrText?: string;
  }>;
  profilePicture: string;
  profileId: string;
  profileName: string;
  likesCount: string | number;
  commentsCount: number;
  comments: any[];
  threadingDepth: number;
  facebookId: string;
  postTitle: string;
  pageAdLibrary: {
    is_business_page_active: boolean;
    id: string;
  };
  inputUrl: string;
  profileUrl?: string;
}

export interface Post {
  id: string;
  url: string;
  title: string;
  timestamp_captured: number;
  metadata: string; // JSON string
  checksum_post?: string;
  filename: string; // Original JSON filename
}

export interface Comment {
  id: string;
  post_id: string;
  url: string;
  timestamp_captured: number;
  screenshot_path?: string;
  metadata: string; // JSON string
  checksum_screenshot?: string;
  checksum_comment_text?: string;
  // AI analysis fields (nullable)
  is_negative?: number | boolean;
  confidence_score?: number | null;
  reasoning?: string | null;
  ai_model?: string | null;
  ai_analyzed_at?: number | null;
}

export interface DatabaseComment extends Comment {
  // Parsed metadata for easier access
  text: string;
  date: string;
  profileName: string;
  likesCount: string | number;
  commentsCount: number;
  threadingDepth: number;
}
