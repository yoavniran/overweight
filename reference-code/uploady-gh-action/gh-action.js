import fs from "fs";
import path from "path";
import { filesize } from "filesize";
import { parseFileSize } from "../../../scripts/utils.mjs";

const BRANCH = process.env.GITHUB_REF_NAME || process.env.GITHUB_REF;
const BUNDLE_SIZE_REPORT_FILE = "bundle-size-report.json";

const saveUpdatedMasterData = (data, masterData, core) => {
    if (BRANCH.includes("master")) {
        const hasUpdate = data.find((row) => {
            const masterRow = masterData.find((r) => r.name === row.name);
            return !masterRow || row.size !== masterRow.size || row.max !== masterRow.max;
        });

        if (hasUpdate) {
            const reportPath = path.resolve(`./${BUNDLE_SIZE_REPORT_FILE}`);
            core.info(`saving updated master bundle size report to: ${reportPath}`);

            //sort data by name prop so contents don't change based on order of insert:
            data.sort((a, b) => a.name.localeCompare(b.name));

            fs.writeFileSync(reportPath, JSON.stringify(data), { encoding: "utf-8" });

            core.setOutput("SAVED_MASTER_REPORT", reportPath);
        } else {
            core.info("not saving updated master bundle size report - no change found");
        }
    } else {
        core.info("skipping saving updated master bundle size report because we're not on MASTER");
    }
};

const getBundleSizeReportMasterData = (core) => {
    const reportPath = path.resolve(`./${BUNDLE_SIZE_REPORT_FILE}`);
    core.info(`looking for bundle size report file from MASTER at ${reportPath}`);

    const str = fs.readFileSync(reportPath, { encoding: "utf-8" });
    core.info("read master data to bundle size report: " + str);
    return JSON.parse(str);
};

const getWithPreviousBundleSizeReport = (data, masterData, core) => {
    let updatedData = data;

    if (!BRANCH.includes("master")) {
        updatedData = data.map((row) => {
            const masterRow = masterData.find((mr) => mr.name === row.name);

            const diff = masterRow ?
                (Math.round(parseFileSize(row.size) - parseFileSize(masterRow.size))) : "N/A";

            if (diff && diff !== "N/A") {
                core.info(`bundle size diff for '${row.name}': ${diff}`);
            } else {
                core.info(`no previous bundle size data found for '${row.name}'`);
            }

            const trend = masterRow ?
                (diff > 0 ? "🔺" : (diff < 0 ? "⬇" : "=")) : "N/A";

            return {
                ...row,
                diff,
                trend,
            };
        });
    } else {
        core.info("skipping download of bundle size report artifact on MASTER");
    }

    return updatedData;
};


const getReportValue = (key, val) => {
    switch (key) {
        case "success":
            return val === true ? "🟢" : "💥"
        case "max":
            return filesize(val, { standard: "jedec", spacer: "" });
        case "diff":
            return filesize(val, { standard: "jedec", spacer: "" });
        default:
            return `${val}`;
    }
};

const getTableReportData = (data, core) => {
    const report = [
        //headers
        Object.keys(data[0])
            .map((key) =>
                ({ data: key, header: true })),
        //rows
        ...data.map((row) =>
            Object.entries(row).map(([key, val]) =>
                ({ data: getReportValue(key, val) }))),
    ];

    core.debug("Summary Table: " + JSON.stringify(report));

    return report;
};

export default async ({ core }) => {
    core.info("processing bundle size report...");

    const dataStr = process.env.BUNDLE_SIZE_REPORT;
    core.info("got bundle size data input: " + dataStr);
    const data = JSON.parse(dataStr);

    const masterData = getBundleSizeReportMasterData(core);

    const dataWithMasterCompare = getWithPreviousBundleSizeReport(data, masterData, core);
    core.debug("bundle size data with compare: " + dataWithMasterCompare);
    core.setOutput("BUNDLE_SIZE_REPORT_WITH_COMPARE", JSON.stringify(dataWithMasterCompare));

    const report = getTableReportData(dataWithMasterCompare, core);

    core.summary
        .addHeading("📦 Bundle Size Report")
        .addTable(report);

    //retrieve the table from the summary, so we can also add it to the PR as a comment
    const reportTable = `<table>${core.summary.stringify().split("<table>")[1].split("</table>")[0]}</table>`;
    core.debug("GOT TABLE FROM SUMMARY " + reportTable);
    core.setOutput("BUNDLE_SIZE_REPORT_TABLE", reportTable);

    //flush to summary
    await core.summary.write();

    const failed = data.find(({ success }) => !success);
    if (failed) {
        //fail the action if any bundle size check failed
        throw new Error(`Bundle size check failed for: ${failed.name} (${failed.size}/${failed.max})`);
    }

    saveUpdatedMasterData(data, masterData, core)
};