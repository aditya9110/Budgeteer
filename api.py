import os
import base64
import tempfile
import traceback
from datetime import datetime, timedelta

import db
from src.automate_budget import (
    fetch_transactions_from_bank_statement,
    classify_transaction
)


class Api:
    """
    Every public method is callable from JS as:
        await callPython("method_name", arg1, arg2)

    All methods return:
        { "ok": True,  "data": ... }
        { "ok": False, "error": "..." }
    """

    # ─────────────────────────────────────────────
    # IMPORT STATEMENT
    # ─────────────────────────────────────────────

    def import_statement(self, filename, base64_data):
        """
        Parses and imports a bank statement.
        Returns DATA_EXISTS error if data for that month already exists.
        """
        try:
            transactions_df, year, month = self._parse_file(filename, base64_data)
            if transactions_df is None:
                return {"ok": False, "error": year}  # year holds error message here

            # Check if month already imported
            if db.is_month_imported(year, month):
                return {"ok": False, "error": f"DATA_EXISTS:{year}:{month}"}

            return self._do_import(transactions_df, year, month)

        except Exception as e:
            traceback.print_exc()
            return {"ok": False, "error": str(e)}


    def import_statement_force(self, filename, base64_data):
        """
        Same as import_statement but skips the overwrite check.
        Called when user confirms overwrite from the modal.
        """
        try:
            transactions_df, year, month = self._parse_file(filename, base64_data)
            if transactions_df is None:
                return {"ok": False, "error": year}  # year holds error message here

            return self._do_import(transactions_df, year, month)

        except Exception as e:
            traceback.print_exc()
            return {"ok": False, "error": str(e)}


    # ─────────────────────────────────────────────
    # INTERNAL HELPERS
    # ─────────────────────────────────────────────

    def _parse_file(self, filename, base64_data):
        """
        Decodes base64 file, saves to temp, parses transactions.
        Returns (transactions_df, year, month) on success.
        Returns (None, error_message, None) on failure.
        """
        try:
            file_bytes = base64.b64decode(base64_data)
            suffix = ".xlsx" if filename.endswith(".xlsx") else ".xls"

            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(file_bytes)
                tmp_path = tmp.name

            try:
                transactions_df = fetch_transactions_from_bank_statement(tmp_path)
            finally:
                os.unlink(tmp_path)  # always clean up temp file

            if transactions_df.empty:
                return None, "No transactions found in the file.", None

            # Detect year and month from first transaction date
            first_date = transactions_df.iloc[0]["Date"]  # format: DD-MM-YYYY
            parsed     = datetime.strptime(first_date, "%d-%m-%Y")
            year       = parsed.year
            month      = parsed.strftime("%B")

            return transactions_df, year, month

        except Exception as e:
            return None, str(e), None


    def _do_import(self, transactions_df, year, month):
        """
        Classifies and inserts transactions into SQLite.
        Returns count of expense transactions imported.
        """
        categories = db.get_categories_settings()
        parsed_categories = {c["name"]: c["keywords"].split(",") for c in categories}
        rows = []
        for _, row in transactions_df.iterrows():
            description = str(row["Transaction Remarks"])
            is_salary   = 1 if "salary" in description.lower() else 0

            if is_salary:
                rows.append({
                    "date":        row["Date"],
                    "description": description[:90].strip(),
                    "source":      None,
                    "type":        None,
                    "spend":       0,
                    "remarks":     str(row["Withdrawal Amount (INR)"]),
                    "is_salary":   1
                })
            else:
                category, matched_keyword = classify_transaction(parsed_categories, description)
                rows.append({
                    "date":        row["Date"],
                    "description": description[:90].strip(),
                    "source":      "Bank Statement",
                    "type":        category,
                    "spend":       float(row["Withdrawal Amount (INR)"]),
                    "remarks":     matched_keyword,
                    "is_salary":   0
                })

        db.insert_transactions(year, month, rows)

        expense_count = len([r for r in rows if not r["is_salary"]])
        return {
            "ok": True,
            "data": {
                "count": expense_count,
                "year":  year,
                "month": month
            }
        }


    def _get_budget_status(self, year, month):
        """
        Calculates budget status based on previous month's salary.
        """
        try:
            current_date = datetime.strptime(f"01-{month}-{year}", "%d-%B-%Y")
            prev_date    = current_date - timedelta(days=1)
            prev_month   = prev_date.strftime("%B")
            prev_year    = prev_date.year

            prev_salary = db.get_transactions_with_salary(prev_year, prev_month)
            curr_salary = db.get_transactions_with_salary(year, month)

            post_salary_spend = 0
            salary = None
            for prev_tx in prev_salary:
                if prev_tx["is_salary"]:
                    salary = float(prev_tx["remarks"])
                    continue
                if salary:
                    post_salary_spend += prev_tx["spend"]

            if not salary:
                return None

            current_spend = 0
            for curr_tx in curr_salary:
                if curr_tx["is_salary"]:
                    break
                current_spend += curr_tx["spend"]

            total_expense = post_salary_spend + current_spend
            diff          = salary - total_expense

            return {
                "salary":        salary,
                "total_expense": total_expense,
                "diff":          diff,
                "status":        "surplus" if diff > 0 else "deficit" if diff < 0 else "exact"
            }

        except Exception:
            return None


    # ─────────────────────────────────────────────
    # TRANSACTIONS — READ
    # ─────────────────────────────────────────────

    def get_transactions(self, year, month):
        """Returns all non-salary transactions for a given month."""
        try:
            rows = db.get_transactions(int(year), month)
            return {"ok": True, "data": rows}
        except Exception as e:
            return {"ok": False, "error": str(e)}


    # ─────────────────────────────────────────────
    # TRANSACTIONS — WRITE
    # ─────────────────────────────────────────────

    def add_transaction(self, payload):
        """Adds a single new transaction row."""
        try:
            row = {
                "date":        payload.get("date"),
                "description": payload.get("description"),
                "source":      payload.get("source", "Manual"),
                "type":        payload.get("type"),
                "spend":       float(payload.get("spend", 0)),
                "remarks":     payload.get("remarks", ""),
                "is_salary":   0
            }
            year  = int(payload["year"])
            month = payload["month"]
            db.add_transaction(year, month, row)
            return {"ok": True, "data": None}
        except Exception as e:
            traceback.print_exc()
            return {"ok": False, "error": str(e)}


    def update_transaction(self, payload):
        """Updates an existing transaction by id."""
        try:
            db.update_transaction(
                tx_id       = int(payload["id"]),
                date        = payload.get("date"),
                description = payload.get("description"),
                source      = payload.get("source"),
                type_       = payload.get("type"),
                spend       = float(payload.get("spend", 0)),
                remarks     = payload.get("remarks", "")
            )
            return {"ok": True, "data": None}
        except Exception as e:
            traceback.print_exc()
            return {"ok": False, "error": str(e)}


    def delete_transaction(self, tx_id):
        """Deletes a transaction by id."""
        try:
            db.delete_transaction(int(tx_id))
            return {"ok": True, "data": None}
        except Exception as e:
            return {"ok": False, "error": str(e)}


    # ─────────────────────────────────────────────
    # DASHBOARD DATA
    # ─────────────────────────────────────────────

    def get_dashboard_data(self, year, month):
        """
        Returns all data needed to render the dashboard in one call.
        """
        try:
            year         = int(year)
            transactions = db.get_transactions(year, month)
            categories   = db.get_categories(year, month)
            daily_spend  = db.get_daily_spend(year, month)

            budget_status    = self._get_budget_status(year, month)
            top_transactions = sorted(transactions, key=lambda x: x["spend"], reverse=True)[:8]

            source_map = {}
            for t in transactions:
                src = t["source"] or "Unknown"
                source_map[src] = source_map.get(src, 0) + t["spend"]
            source_breakdown = [{"source": k, "spend": v} for k, v in source_map.items()]

            return {
                "ok": True,
                "data": {
                    "transactions":     transactions,
                    "categories":       categories,
                    "daily_spend":      daily_spend,
                    "budget_status":    budget_status,
                    "top_transactions": top_transactions,
                    "source_breakdown": source_breakdown
                }
            }

        except Exception as e:
            traceback.print_exc()
            return {"ok": False, "error": f"Unexpected error: {str(e)}"}
        
    
    # ─────────────────────────────────────────────
    # SETTINGS — CATEGORIES
    # ─────────────────────────────────────────────

    def get_categories_settings(self):
        try:
            rows = db.get_categories_settings()
            return {"ok": True, "data": rows}
        except Exception as e:
            return {"ok": False, "error": str(e)}


    def add_category(self, payload):
        try:
            db.add_category(
                name     = payload["name"],
                keywords = payload.get("keywords", ""),
                grp      = payload.get("grp", "None")
            )
            return {"ok": True, "data": None}
        except Exception as e:
            return {"ok": False, "error": str(e)}


    def update_category(self, payload):
        try:
            db.update_category(
                cat_id   = int(payload["id"]),
                name     = payload["name"],
                keywords = payload.get("keywords", ""),
                grp      = payload.get("grp", "None")
            )
            return {"ok": True, "data": None}
        except Exception as e:
            return {"ok": False, "error": str(e)}


    def delete_category(self, cat_id):
        try:
            db.delete_category(int(cat_id))
            return {"ok": True, "data": None}
        except Exception as e:
            return {"ok": False, "error": str(e)}
    

    def reorder_categories(self, ordered_ids):
        try:
            db.reorder_categories(ordered_ids)
            return {"ok": True, "data": None}
        except Exception as e:
            return {"ok": False, "error": str(e)}


    # ─────────────────────────────────────────────
    # SETTINGS — SOURCES
    # ─────────────────────────────────────────────

    def get_sources(self):
        try:
            rows = db.get_sources()
            return {"ok": True, "data": rows}
        except Exception as e:
            return {"ok": False, "error": str(e)}


    def add_source(self, payload):
        try:
            db.add_source(name=payload["name"])
            return {"ok": True, "data": None}
        except Exception as e:
            return {"ok": False, "error": str(e)}


    def update_source(self, payload):
        try:
            db.update_source(
                source_id = int(payload["id"]),
                name      = payload["name"]
            )
            return {"ok": True, "data": None}
        except Exception as e:
            return {"ok": False, "error": str(e)}


    def delete_source(self, source_id):
        try:
            db.delete_source(int(source_id))
            return {"ok": True, "data": None}
        except Exception as e:
            return {"ok": False, "error": str(e)}


    def get_categories_and_sources(self):
        """Returns categories and sources for dropdown menus."""
        try:
            categories = db.get_categories_settings()
            sources    = db.get_sources()
            return {
                "ok": True,
                "data": {
                    "categories": [c["name"] for c in categories],
                    "sources":    [s["name"] for s in sources]
                }
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}