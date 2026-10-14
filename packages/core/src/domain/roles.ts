// users.role değerleri. Yöneticilik department_managers tablosundan türetilir, rol olarak tutulmaz.
export const USER_ROLES = ["employee", "system_admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];
