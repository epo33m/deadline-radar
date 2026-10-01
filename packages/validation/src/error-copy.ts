/**
 * Error Handling Copy System
 *
 * Core Tone: Calm. Clear. Respectful. Human.
 * Communicates:
 *   1. Something happened.
 *   2. Here's what it means.
 *   3. Here's what you can do next.
 *
 * Exposes no internal stack traces, SQL errors, or sensitive tokens.
 */

export const CTA_VOCABULARY = [
  "Try Again",
  "Refresh",
  "Retry",
  "Go Back",
  "Go Home",
  "Sign In",
  "Verify Email",
  "Send New Link",
  "Reset Password",
  "Review",
  "Continue",
  "Cancel",
  "Delete",
  "Save",
  "Create",
  "Create New",
  "View Item",
  "Contact Support",
  "Choose Another File",
  "Clear Search",
  "Clear Filters",
  "Done",
] as const;

export type CtaAction = (typeof CTA_VOCABULARY)[number];

export type ErrorCopyItem = {
  title: string;
  message: string;
  cta?: CtaAction | CtaAction[];
};

export const ERROR_COPY = {
  // 1. General / Unknown
  general: {
    somethingWentWrong: {
      title: "Something went wrong",
      message: "We couldn't complete this action. Please try again.",
      cta: "Try Again",
    },
    couldNotComplete: {
      title: "We couldn't complete that",
      message: "Something went wrong while processing your request. Please try again.",
      cta: "Try Again",
    },
    somethingNotWorking: {
      title: "Something isn't working",
      message: "We're having trouble completing this right now. Please try again in a moment.",
      cta: "Try Again",
    },
  },

  // 2. Network & Connectivity
  network: {
    noInternetConnection: {
      title: "No internet connection",
      message: "Check your connection and try again.",
      cta: "Try Again",
    },
    connectionInterrupted: {
      title: "Connection interrupted",
      message: "Your connection was interrupted. Please try again.",
      cta: "Try Again",
    },
    unableToReachService: {
      title: "Unable to reach the service",
      message: "We couldn't connect to the service. Check your connection and try again.",
      cta: "Try Again",
    },
    requestTimedOut: {
      title: "Request timed out",
      message: "The request took too long to complete. Please try again.",
      cta: "Try Again",
    },
  },

  // 3. Authentication
  auth: {
    sessionExpired: {
      title: "Your session has expired",
      message: "Sign in again to continue.",
      cta: "Sign In",
    },
    signInFailed: {
      title: "Sign-in failed",
      message: "We couldn't sign you in with those details. Check your information and try again.",
      cta: "Try Again",
    },
    invalidCredentials: {
      title: "Invalid credentials",
      message: "The email or password doesn't match our records.",
      cta: "Try Again",
    },
    accountNotFound: {
      title: "Account not found",
      message: "We couldn't find an account with those details.",
      cta: "Try Again",
    },
    accountAlreadyExists: {
      title: "Account already exists",
      message: "An account with this email already exists.",
      cta: "Sign In",
    },
    emailVerificationRequired: {
      title: "Email verification required",
      message: "Verify your email address to continue.",
      cta: "Verify Email",
    },
    verificationLinkExpired: {
      title: "Verification link expired",
      message: "This verification link has expired. Request a new one to continue.",
      cta: "Send New Link",
    },
    verificationLinkInvalid: {
      title: "Verification link invalid",
      message: "This verification link is no longer valid. Request a new one to continue.",
      cta: "Send New Link",
    },
    passwordResetLinkExpired: {
      title: "Password reset link expired",
      message: "This password reset link has expired. Request a new one to continue.",
      cta: "Reset Password",
    },
    passwordResetLinkInvalid: {
      title: "Password reset link invalid",
      message: "This password reset link is no longer valid. Request a new one to continue.",
      cta: "Reset Password",
    },
  },

  // 4. Authorization & Permissions
  authorization: {
    accessDenied: {
      title: "Access denied",
      message: "You don't have permission to perform this action.",
      cta: "Go Back",
    },
    permissionRequired: {
      title: "Permission required",
      message: "You need additional permission to continue.",
      cta: "Go Back",
    },
    adminAccessRequired: {
      title: "Admin access required",
      message: "This action is only available to administrators.",
      cta: "Go Back",
    },
    actionNotAllowed: {
      title: "Action not allowed",
      message: "This action isn't available for your account.",
      cta: "Go Back",
    },
  },

  // 5. Resource / Data
  resource: {
    notFound: {
      title: "Not found",
      message: "We couldn't find what you're looking for.",
      cta: "Go Back",
    },
    itemNoLongerAvailable: {
      title: "This item is no longer available",
      message: "The item may have been removed or moved.",
      cta: "Go Back",
    },
    pageNotFound: {
      title: "Page not found",
      message: "The page you're looking for doesn't exist or has moved.",
      cta: "Go Back",
    },
    resourceUnavailable: {
      title: "Resource unavailable",
      message: "This resource is currently unavailable.",
      cta: "Try Again",
    },
  },

  // 6. Validation
  validation: {
    checkYourInformation: {
      title: "Check your information",
      message: "Some fields need your attention before you can continue.",
      cta: "Review",
    },
    requiredField: "This field is required.",
    invalidFormat: "Enter a valid value.",
    invalidEmail: "Enter a valid email address.",
    invalidDate: "Enter a valid date.",
    invalidNumber: "Enter a valid number.",
    valueTooLarge: "Enter a smaller value.",
    valueTooSmall: "Enter a larger value.",
    tooManyCharacters: "Use fewer characters.",
    tooFewCharacters: (minimum: number) => `Enter at least ${minimum} characters.`,
    passwordRequirements: "Choose a password that meets the requirements.",
    passwordsDoNotMatch: "Make sure both passwords match.",
  },

  // 7. Conflict / Concurrent Changes
  conflict: {
    thisHasChanged: {
      title: "This has changed",
      message: "The information you're viewing is no longer up to date.",
      cta: "Refresh",
    },
    changesCouldNotBeSaved: {
      title: "Changes couldn't be saved",
      message: "This item was changed somewhere else before your changes were saved.",
      cta: "Refresh",
    },
    alreadyExists: {
      title: "Already exists",
      message: "An item with the same information already exists.",
      cta: "Review",
    },
    alreadyCompleted: {
      title: "Already completed",
      message: "This action has already been completed.",
      cta: "Done",
    },
    noLongerAvailable: {
      title: "No longer available",
      message: "This action can no longer be performed because the item has changed.",
      cta: "Refresh",
    },
  },

  // 8. Create / Save / Update
  mutation: {
    couldNotCreate: {
      title: "Couldn't create this",
      message: "We couldn't create this item. Please try again.",
      cta: "Try Again",
    },
    couldNotSaveChanges: {
      title: "Couldn't save changes",
      message: "Your changes couldn't be saved. Please try again.",
      cta: "Try Again",
    },
    couldNotUpdate: {
      title: "Couldn't update this",
      message: "We couldn't update this item. Please try again.",
      cta: "Try Again",
    },
    changesSaved: {
      title: "Changes saved",
      message: "Your changes have been saved.",
      cta: "Done",
    },
    nothingToSave: {
      title: "Nothing to save",
      message: "There are no new changes to save.",
    },
  },

  // 9. Delete
  delete: {
    couldNotDelete: {
      title: "Couldn't delete this",
      message: "We couldn't delete this item. Please try again.",
      cta: "Try Again",
    },
    cannotBeDeleted: {
      title: "This can't be deleted",
      message: "This item can't be deleted right now.",
      cta: "Done",
    },
    itemDeleted: {
      title: "Item deleted",
      message: "The item has been deleted.",
      cta: "Done",
    },
    deleteConfirmation: {
      title: "Delete confirmation",
      message: "Are you sure you want to delete this? This action can't be undone.",
      cta: ["Delete", "Cancel"] as CtaAction[],
    },
  },

  // 10. Rate Limiting
  rateLimit: {
    tooManyRequests: {
      title: "Too many requests",
      message: "Please wait a moment before trying again.",
      cta: "Try Again",
    },
    pleaseSlowDown: {
      title: "Please slow down",
      message: "You've made too many requests in a short time. Try again shortly.",
      cta: "Try Again",
    },
  },

  // 11. Server / Service Errors
  server: {
    serviceUnavailable: {
      title: "Service unavailable",
      message: "We're having trouble processing your request right now. Please try again in a moment.",
      cta: "Try Again",
    },
    serviceTemporarilyUnavailable: {
      title: "Service temporarily unavailable",
      message: "The service is temporarily unavailable. Please try again shortly.",
      cta: "Try Again",
    },
    serverError: {
      title: "Server error",
      message: "Something went wrong on our side. Please try again.",
      cta: "Try Again",
    },
    maintenance: {
      title: "Maintenance",
      message: "We're making a few improvements. Please try again later.",
      cta: "Try Again",
    },
  },

  // 12. Database / Data Processing (No internal DB details exposed)
  dataProcessing: {
    couldNotLoadData: {
      title: "Couldn't load your data",
      message: "We couldn't load this information right now. Please try again.",
      cta: "Try Again",
    },
    couldNotSaveData: {
      title: "Couldn't save your data",
      message: "We couldn't save your changes. Please try again.",
      cta: "Try Again",
    },
    couldNotProcessRequest: {
      title: "Couldn't process your request",
      message: "We couldn't process your request right now. Please try again.",
      cta: "Try Again",
    },
    dataUnavailable: {
      title: "Data unavailable",
      message: "This information isn't available right now.",
      cta: "Try Again",
    },
  },

  // 13. File Upload
  upload: {
    uploadFailed: {
      title: "Upload failed",
      message: "We couldn't upload this file. Please try again.",
      cta: "Try Again",
    },
    fileTooLarge: {
      title: "File too large",
      message: "This file is too large to upload.",
      cta: "Choose Another File",
    },
    fileTypeNotSupported: {
      title: "File type not supported",
      message: "This file type isn't supported.",
      cta: "Choose Another File",
    },
    fileIsCorrupted: {
      title: "File is corrupted",
      message: "We couldn't read this file. Try uploading a different file.",
      cta: "Choose Another File",
    },
    uploadInterrupted: {
      title: "Upload interrupted",
      message: "The upload was interrupted. Please try again.",
      cta: "Try Again",
    },
    uploadComplete: {
      title: "Upload complete",
      message: "Your file has been uploaded.",
      cta: "Done",
    },
  },

  // 14. Import / Export
  importExport: {
    importFailed: {
      title: "Import failed",
      message: "We couldn't import this data. Check the file and try again.",
      cta: "Try Again",
    },
    exportFailed: {
      title: "Export failed",
      message: "We couldn't export your data. Please try again.",
      cta: "Try Again",
    },
    nothingToExport: {
      title: "Nothing to export",
      message: "There's no data available to export.",
      cta: "Done",
    },
    invalidImportFile: {
      title: "Invalid import file",
      message: "This file doesn't contain the data we expected.",
      cta: "Choose Another File",
    },
  },

  // 15. Search
  search: {
    searchUnavailable: {
      title: "Search unavailable",
      message: "We couldn't complete your search. Please try again.",
      cta: "Try Again",
    },
    noResults: {
      title: "No results",
      message: "No results found.",
      cta: "Clear Search",
    },
    searchFailed: {
      title: "Search failed",
      message: "We couldn't complete your search right now.",
      cta: "Try Again",
    },
  },

  // 16. Empty States
  emptyState: {
    nothingHereYet: {
      title: "Nothing here yet",
      message: "There's nothing here yet.",
      cta: "Create New",
    },
    noItems: {
      title: "No items",
      message: "You don't have any items yet.",
      cta: "Create New",
    },
    noNotifications: {
      title: "No notifications",
      message: "You're all caught up.",
    },
    noActivity: {
      title: "No activity",
      message: "There's no activity to show yet.",
    },
    noResultsFiltered: {
      title: "No results",
      message: "No results found. Try a different search or filter.",
      cta: "Clear Filters",
    },
  },

  // 17. Offline / Degraded Mode
  offline: {
    youAreOffline: {
      title: "You're offline",
      message: "Some features may be unavailable until you're back online.",
      cta: "Try Again",
    },
    workingOffline: {
      title: "Working offline",
      message: "You're offline. Changes may be saved when your connection returns.",
    },
    connectionRestored: {
      title: "Connection restored",
      message: "You're back online.",
    },
  },

  // 18. Timeout / Long-Running Operations
  timeout: {
    takingLongerThanExpected: {
      title: "Taking longer than expected",
      message: "This is taking a little longer than expected.",
      cta: "Try Again",
    },
    stillWorking: {
      title: "Still working",
      message: "We're still processing your request. You can wait here or try again later.",
      cta: "Done",
    },
    processing: {
      title: "Processing",
      message: "Your request is being processed.",
    },
  },

  // 19. Duplicate Actions
  duplicate: {
    alreadySubmitted: {
      title: "Already submitted",
      message: "This request has already been submitted.",
      cta: "Done",
    },
    alreadyExists: {
      title: "Already exists",
      message: "This item already exists.",
      cta: "View Item",
    },
    alreadyProcessed: {
      title: "Already processed",
      message: "This request has already been processed.",
      cta: "Done",
    },
  },

  // 20. State / Lifecycle Errors
  lifecycle: {
    actionUnavailable: {
      title: "Action unavailable",
      message: "This action isn't available in the current state.",
      cta: "Go Back",
    },
    alreadyConfirmed: {
      title: "Already confirmed",
      message: "This item has already been confirmed.",
      cta: "Done",
    },
    alreadyCancelled: {
      title: "Already cancelled",
      message: "This item has already been cancelled.",
      cta: "Done",
    },
    cannotBeChanged: {
      title: "Cannot be changed",
      message: "This item can no longer be changed.",
      cta: "Done",
    },
    cannotBeCompleted: {
      title: "Cannot be completed",
      message: "This action can't be completed in the current state.",
      cta: "Go Back",
    },
  },

  // 21. Permission + State Combination (Avoid exposing internal rules)
  permissionState: {
    actionUnavailable: {
      title: "Action unavailable",
      message: "You can't perform this action right now.",
      cta: "Go Back",
    },
  },

  // 22. Security-Sensitive Errors (Avoid enumeration or leakage)
  securitySensitive: {
    unableToContinue: {
      title: "Unable to continue",
      message: "We couldn't complete your request.",
      cta: "Try Again",
    },
  },

  // 23. Unexpected Application Errors
  unexpected: {
    somethingWentWrong: {
      title: "Something went wrong",
      message: "We couldn't complete this action. Please try again. If the problem continues, contact support.",
      cta: ["Try Again", "Contact Support"] as CtaAction[],
    },
    couldNotLoadPage: {
      title: "We couldn't load this page",
      message: "Something went wrong while loading this page. Please try again.",
      cta: "Try Again",
    },
    couldNotLoadData: {
      title: "We couldn't load your data",
      message: "Something went wrong while loading your data. Please try again.",
      cta: "Try Again",
    },
  },

  // 24. Critical / Blocking Errors
  critical: {
    couldNotLoadPage: {
      title: "We couldn't load this page",
      message: "Something went wrong and this page can't be displayed right now.",
      cta: "Try Again",
    },
    somethingWentWrong: {
      title: "Something went wrong",
      message: "We couldn't continue because something unexpected happened. Please try again.",
      cta: "Try Again",
    },
    serviceUnavailable: {
      title: "Service unavailable",
      message: "This service isn't available right now. Please try again later.",
      cta: "Try Again",
    },
  },

  // 25. Support / Escalation
  support: {
    stillHavingTrouble: {
      title: "Still having trouble?",
      message: "If this keeps happening, contact support and include the reference ID below.",
      cta: "Contact Support",
    },
  },
} as const;

// 26. Generic Toast Library
export const TOAST_COPY = {
  save: "Changes saved.",
  delete: "Item deleted.",
  create: "Item created.",
  update: "Changes updated.",
  copy: "Copied to clipboard.",
  upload: "File uploaded.",
  download: "Download started.",
  undo: "Changes undone.",
  failed: "Couldn't complete that action.",
  retry: "Couldn't complete that action. Try again.",
} as const;

export type ToastCopyKey = keyof typeof TOAST_COPY;

/**
 * Format a reference ID safely (REF-XXXXXXXX) without exposing stack traces, DB errors, or credentials.
 */
export function formatReferenceId(rawId?: string | null): string {
  if (!rawId) {
    const randomHex = Math.random().toString(36).substring(2, 10).toUpperCase();
    return `REF-${randomHex}`;
  }
  // Sanitize to only alphanumeric and dashes
  const sanitized = rawId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 16).toUpperCase();
  return sanitized.startsWith("REF-") ? sanitized : `REF-${sanitized}`;
}

/**
 * Resolve error copy from error code or general fallback.
 */
export function resolveErrorCopy(
  codeOrKey?: string | null,
  fallback: ErrorCopyItem = ERROR_COPY.general.somethingWentWrong,
): ErrorCopyItem {
  if (!codeOrKey) return fallback;

  switch (codeOrKey.toUpperCase()) {
    case "UNAUTHORIZED":
    case "SESSION_EXPIRED":
      return ERROR_COPY.auth.sessionExpired;
    case "FORBIDDEN":
    case "ACCESS_DENIED":
      return ERROR_COPY.authorization.accessDenied;
    case "NOT_FOUND":
      return ERROR_COPY.resource.notFound;
    case "CONFLICT":
    case "IDEMPOTENCY_CONFLICT":
      return ERROR_COPY.conflict.changesCouldNotBeSaved;
    case "RATE_LIMITED":
      return ERROR_COPY.rateLimit.tooManyRequests;
    case "PAYLOAD_TOO_LARGE":
      return ERROR_COPY.upload.fileTooLarge;
    case "TIMEOUT":
      return ERROR_COPY.network.requestTimedOut;
    case "DEPENDENCY_FAILURE":
      return ERROR_COPY.server.serviceUnavailable;
    case "INTERNAL":
    case "SERVER_ERROR":
      return ERROR_COPY.server.serverError;
    default:
      return fallback;
  }
}
