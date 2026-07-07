import { BABAMediator, BABAProxy, BabaStr, BaseCC, BABA } from "../BABA";
import { OutPutType } from "../model/ConstDefind";
import { ITreeDataNormal } from "../model/TreeNodeModel";
import { promptForSignIn, ShowMessage } from "../utils/OutputUtils";

export interface IFavoriteListInfo {
  id_hash: string;
  name: string;
  slug: string;
}

interface IFavoriteListGraphQL {
  idHash?: string;
  name?: string;
  questions?: Array<{ questionId?: string }>;
}

class FavoriteData {
  lists: IFavoriteListInfo[] = [];
  questionsByHash: Map<string, string[]> = new Map<string, string[]>();
  listsLoaded: boolean = false;
  loadingLists: boolean = false;
  loadingQuestions: Set<string> = new Set<string>();

  clear(): void {
    this.lists = [];
    this.questionsByHash.clear();
    this.listsLoaded = false;
    this.loadingLists = false;
    this.loadingQuestions.clear();
  }
}

const favoriteData: FavoriteData = new FavoriteData();

function parseFavoriteLists(data: any): void {
  const favoritesLists = data?.favoritesLists || {};
  // 仅展示用户自建收藏夹，不包含官方题单(officialFavorites)或关注列表(watchedFavorites)
  const allLists: IFavoriteListGraphQL[] = [...(favoritesLists.allFavorites || [])];
  const seen = new Set<string>();
  favoriteData.lists = [];
  favoriteData.questionsByHash.clear();

  for (const item of allLists) {
    const idHash = item?.idHash;
    const name = item?.name;
    if (!idHash || !name || seen.has(idHash)) {
      continue;
    }
    seen.add(idHash);
    favoriteData.lists.push({
      id_hash: idHash,
      name,
      slug: (item as any)?.slug || idHash,
    });
    const qids = (item.questions || [])
      .map((q) => `${q?.questionId || ""}`)
      .filter((qid) => qid.length > 0);
    favoriteData.questionsByHash.set(idHash, qids);
  }
}

function parseChildJson(raw: string): any {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    throw new Error("Empty response from leetcode query");
  }
  try {
    return JSON.parse(trimmed);
  } catch (_e) {
    throw new Error(`Invalid JSON response: ${trimmed.slice(0, 200)}`);
  }
}

export class FavoriteDataProxy extends BABAProxy {
  static NAME = BabaStr.FavoriteDataProxy;
  constructor() {
    super(FavoriteDataProxy.NAME);
  }

  public isListsLoaded(): boolean {
    return favoriteData.listsLoaded;
  }

  public isLoadingLists(): boolean {
    return favoriteData.loadingLists;
  }

  public isQuestionsLoaded(hash: string): boolean {
    return favoriteData.questionsByHash.has(hash);
  }

  public isLoadingQuestions(hash: string): boolean {
    return favoriteData.loadingQuestions.has(hash);
  }

  public getFavoriteListSlug(hash: string): string {
    const list = favoriteData.lists.find((item) => item.id_hash === hash);
    return list?.slug || hash;
  }

  public refreshFavoriteQuestionsUI(hash: string): void {
    if (!hash) {
      return;
    }
    BABA.sendNotification(BabaStr.TreeData_searchFavoriteQuestionsFinish, { hash });
  }

  public getAllFavoriteListTreeNodes(): ITreeDataNormal[] {
    return favoriteData.lists.map((list) => ({
      id: list.id_hash,
      name: list.name,
      input: list.slug,
      rootNodeSortId: 6,
    }));
  }

  public getFavoriteQuestionQids(hash: string): string[] {
    return favoriteData.questionsByHash.get(hash) || [];
  }

  public removeQuestionFromList(hash: string, qid: string, fid?: string): void {
    const qids = favoriteData.questionsByHash.get(hash);
    if (!qids) {
      return;
    }
    favoriteData.questionsByHash.set(
      hash,
      qids.filter((id) => id !== qid && (!fid || id !== fid))
    );
  }

  public invalidateQuestionsCache(hash: string): void {
    favoriteData.questionsByHash.delete(hash);
  }

  public addQuestionToList(hash: string, qid: string): void {
    const qids = favoriteData.questionsByHash.get(hash) || [];
    if (qids.includes(qid)) {
      return;
    }
    favoriteData.questionsByHash.set(hash, qids.concat(qid));
  }

  public findFavoriteHashForQuestion(qid: string): string | undefined {
    for (const [hash, qids] of favoriteData.questionsByHash.entries()) {
      if (qids.includes(qid)) {
        return hash;
      }
    }
    return undefined;
  }

  public async searchFavoriteLists(force: boolean = false): Promise<void> {
    const sbp = BABA.getProxy(BabaStr.StatusBarProxy);
    if (!sbp.getUser()) {
      promptForSignIn();
      return;
    }
    if (favoriteData.loadingLists) {
      return;
    }
    if (favoriteData.listsLoaded && !force) {
      return;
    }
    favoriteData.loadingLists = true;
    try {
      const solution: string = await BABA.getProxy(BabaStr.ChildCallProxy)
        .get_instance()
        .getFavoriteLists();
      const query_result = parseChildJson(solution);
      if (query_result?.error) {
        throw new Error(query_result.error);
      }
      parseFavoriteLists(query_result);
      favoriteData.listsLoaded = true;
      BABA.sendNotification(BabaStr.TreeData_searchFavoriteListsFinish);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      BABA.getProxy(BabaStr.LogOutputProxy).get_log().appendLine(`Favorite lists error: ${message}`);
      await ShowMessage("Failed to fetch favorite lists. 请查看控制台信息~", OutPutType.error);
    } finally {
      favoriteData.loadingLists = false;
    }
  }

  public async searchFavoriteQuestions(hash: string, force: boolean = false): Promise<void> {
    const sbp = BABA.getProxy(BabaStr.StatusBarProxy);
    if (!sbp.getUser()) {
      promptForSignIn();
      return;
    }
    if (!hash) {
      return;
    }
    if (favoriteData.loadingQuestions.has(hash)) {
      return;
    }
    if (favoriteData.questionsByHash.has(hash) && !force) {
      return;
    }
    favoriteData.loadingQuestions.add(hash);
    const favoriteSlug = this.getFavoriteListSlug(hash);
    try {
      const solution: string = await BABA.getProxy(BabaStr.ChildCallProxy)
        .get_instance()
        .getFavoriteQuestions(favoriteSlug, hash);
      const query_result = parseChildJson(solution);
      if (query_result?.error) {
        throw new Error(query_result.error);
      }
      const questions = query_result?.favoriteQuestionList?.questions || [];
      const qids = questions
        .map((item) => `${item?.questionId || ""}`)
        .filter((qid) => qid.length > 0);
      favoriteData.questionsByHash.set(hash, qids);
      BABA.sendNotification(BabaStr.TreeData_searchFavoriteQuestionsFinish, { hash });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      BABA.getProxy(BabaStr.LogOutputProxy)
        .get_log()
        .appendLine(`Favorite questions error (${hash}): ${message}`);
      if (!favoriteData.questionsByHash.has(hash)) {
        favoriteData.questionsByHash.set(hash, []);
      }
      BABA.sendNotification(BabaStr.TreeData_searchFavoriteQuestionsFinish, { hash });
    } finally {
      favoriteData.loadingQuestions.delete(hash);
    }
  }
}

export class FavoriteDataMediator extends BABAMediator {
  static NAME = BabaStr.FavoriteDataMediator;
  constructor() {
    super(FavoriteDataMediator.NAME);
  }

  listNotificationInterests(): string[] {
    return [
      BabaStr.VSCODE_DISPOST,
      BabaStr.USER_LOGIN_SUC,
      BabaStr.USER_LOGIN_OUT,
      BabaStr.BABACMD_refresh,
      BabaStr.TreeData_favoriteChange,
    ];
  }

  async handleNotification(_notification: BaseCC.BaseCC.INotification) {
    switch (_notification.getName()) {
      case BabaStr.VSCODE_DISPOST:
        favoriteData.clear();
        break;
      case BabaStr.USER_LOGIN_SUC:
      case BabaStr.BABACMD_refresh:
        favoriteData.clear();
        await BABA.getProxy(BabaStr.FavoriteDataProxy).searchFavoriteLists(true);
        break;
      case BabaStr.TreeData_favoriteChange:
        await BABA.getProxy(BabaStr.FavoriteDataProxy).searchFavoriteLists(true);
        break;
      case BabaStr.USER_LOGIN_OUT:
        favoriteData.clear();
        break;
      default:
        break;
    }
  }
}
