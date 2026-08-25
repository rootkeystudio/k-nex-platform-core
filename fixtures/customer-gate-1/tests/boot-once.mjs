import { bootGate1Application } from "../dist/src/boot.js";

try {
  await bootGate1Application({ key: process.env.BOOT_KEY });
  console.log("READY");
  process.exit(0);
} catch (error) {
  if (error?.code === process.env.EXPECT_ERROR) {
    console.log(error.code);
    process.exit(0);
  }
  console.error(error);
  process.exit(2);
}
