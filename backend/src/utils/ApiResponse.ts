export class ApiResponse<T = unknown> {
  public readonly success: boolean;
  public readonly message: string;
  public readonly data: T | null;
  public readonly errors: string[] | undefined;
  public readonly timestamp: string;

  constructor(
    success: boolean,
    message: string,
    data: T | null = null,
    errors?: string[]
  ) {
    this.success = success;
    this.message = message;
    this.data = data;
    this.errors = errors;
    this.timestamp = new Date().toISOString();
  }

  static success<T>(message: string, data: T | null = null): ApiResponse<T> {
    return new ApiResponse<T>(true, message, data);
  }

  static error(message: string, errors?: string[]): ApiResponse<null> {
    return new ApiResponse<null>(false, message, null, errors);
  }

  static paginated<T>(
    message: string,
    data: T[],
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    }
  ): { success: boolean; message: string; data: T[]; pagination: typeof pagination; timestamp: string } {
    return {
      success: true,
      message,
      data,
      pagination,
      timestamp: new Date().toISOString(),
    };
  }
}
