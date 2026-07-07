/*
 * https://github.com/ccagml/leetcode-extension/src/rpc/factory/api/starApi.ts
 * Path: https://github.com/ccagml/leetcode-extension
 * Created Date: Thursday, November 17th 2022, 11:44:14 am
 * Author: ccagml
 *
 * Copyright (c) 2022 ccagml . All rights reserved.
 */

import { reply } from "../../utils/ReplyUtils";

import { sessionUtils } from "../../utils/sessionUtils";
import { ApiBase } from "../apiBase";
import { chainMgr } from "../../actionChain/chainManager";

function formatError(e: any): string {
  if (!e) {
    return "unknown error";
  }
  if (typeof e === "string") {
    return e;
  }
  if (e instanceof Error) {
    return e.message;
  }
  if (e.msg) {
    return e.statusCode ? `${e.msg} [code=${e.statusCode}]` : e.msg;
  }
  return String(e);
}

class StarApi extends ApiBase {
  constructor() {
    super();
  }

  callArg(argv) {
    let argv_config = this.api_argv()
      .option("d", {
        alias: "delete",
        type: "boolean",
        describe: "Unstar question",
        default: false,
      })
      .option("H", {
        alias: "favoriteHash",
        type: "string",
        default: "",
        describe: "Target favorite list hash",
      })
      .positional("keyword", {
        type: "string",
        describe: "Question name or id",
        default: "",
      });

    argv_config.parseArgFromCmd(argv);

    return argv_config.get_result();
  }

  call(argv) {
    sessionUtils.argv = argv;
    const favoriteHash = argv.H || argv.favoriteHash || "";
    const replyError = (e: any): never => {
      reply.info(JSON.stringify({ error: formatError(e) }));
      process.exit(1);
    };

    chainMgr.getChainHead().getProblems(false, function (e, problems) {
      if (e) return replyError(e);

      const keyword = argv.keyword;
      const normalized = Number(keyword) || keyword;
      let problem;
      if (favoriteHash) {
        // Favorite list GraphQL questionId is backend question_id; avoid fid-only collisions.
        problem = problems.find(function (x) {
          return x.id + "" === normalized + "";
        });
        if (!problem) {
          problem = {
            id: normalized,
            fid: normalized,
            name: keyword,
            favoriteIdHash: favoriteHash,
            favoriteQuestionId: normalized,
          };
        } else {
          problem.favoriteIdHash = favoriteHash;
          problem.favoriteQuestionId = normalized;
        }
      } else {
        problem = problems.find(function (x) {
          return x.id + "" === normalized + "" || x.fid + "" === normalized + "";
        });
      }
      if (!problem) {
        return replyError(new Error(`Problem not found: ${keyword}`));
      }

      chainMgr.getChainHead().starProblem(
        problem,
        !argv.delete,
        function (e, flag) {
          if (e) return replyError(e);
          chainMgr.getChainHead().updateProblem(problem, { starred: flag });
          reply.info(`[${problem.fid}] ${problem.name} ${flag ? "icon.like" : "icon.unlike"}`);
          process.exit(0);
        }
      );
      return;
    });
  }
}

export const starApi: StarApi = new StarApi();
