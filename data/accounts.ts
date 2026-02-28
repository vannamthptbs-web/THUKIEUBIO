
export interface StudentAccount {
  id: string;
  name: string;
  password: string;
}

export const ACCOUNTS: StudentAccount[] = [
  ...Array.from({ length: 100 }, (_, i) => {
    const num = (i + 1).toString().padStart(3, '0');
    return {
      id: `HS${num}`,
      name: `Học sinh ${num}`,
      password: `pass${num}`
    };
  }),
  {
    id: "DEMO",
    name: "Tài khoản Demo",
    password: "demo101"
  }
];
