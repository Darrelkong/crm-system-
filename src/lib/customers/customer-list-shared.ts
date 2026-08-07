export type CustomerCreatorOption = {
  id: string;
  displayName: string;
  role: string;
};

export const CUSTOMER_LIST_PAGE_SIZE = 40;

export type CustomerListPaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};
